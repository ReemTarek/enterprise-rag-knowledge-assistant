using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Application.Common;
using EnterpriseRag.Domain.Audit;
using EnterpriseRag.Domain.Identity;
using EnterpriseRag.Domain.KnowledgeBases;
using EnterpriseRag.Infrastructure.Persistence.Configurations;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace EnterpriseRag.Infrastructure.Persistence;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options), IAppDbContext
{
    // SQL Server: 2601 = duplicate key in unique index, 2627 = unique/primary key constraint violation.
    private const int DuplicateKeyInUniqueIndex = 2601;
    private const int UniqueConstraintViolation = 2627;

    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    public DbSet<User> Users => Set<User>();

    public DbSet<KnowledgeBase> KnowledgeBases => Set<KnowledgeBase>();

    public DbSet<KnowledgeBaseUser> KnowledgeBaseUsers => Set<KnowledgeBaseUser>();

    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    IQueryable<User> IAppDbContext.Users => Users;

    // The port promises whole aggregates: members are always loaded (and membership predicates translate to SQL).
    IQueryable<KnowledgeBase> IAppDbContext.KnowledgeBases => KnowledgeBases.Include(k => k.Members);

    IQueryable<RefreshToken> IAppDbContext.RefreshTokens => RefreshTokens;

    IQueryable<AuditLog> IAppDbContext.AuditLogs => AuditLogs;

    void IAppDbContext.Add<T>(T entity) => Set<T>().Add(entity);

    public void SetExpectedRowVersion(KnowledgeBase knowledgeBase, byte[] rowVersion) =>
        Entry(knowledgeBase).Property(k => k.RowVersion).OriginalValue = rowVersion;

    /// <summary>
    /// Persists tracked changes. Optimistic-concurrency failures on a knowledge base surface as
    /// <see cref="ConcurrencyConflictException"/>; other concurrency failures and unique-key violations as
    /// <see cref="ConflictException"/>; in both cases the change tracker is cleared so the failed changes are never
    /// re-sent by a later save in the same scope (entities must be re-queried afterwards).
    /// </summary>
    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        try
        {
            return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
        }
        catch (DbUpdateConcurrencyException ex)
        {
            ChangeTracker.Clear();
            const string message = "The record was modified by another request. Reload it and try again.";
            // Knowledge bases carry a client-visible row version (ETag/If-Match): a mismatch is a failed precondition.
            // Other concurrency failures (e.g. a refresh-token rotation race) stay plain conflicts.
            throw ex.Entries.Any(e => e.Entity is KnowledgeBase)
                ? new ConcurrencyConflictException(message)
                : new ConflictException(message);
        }
        catch (DbUpdateException ex) when (ex.InnerException is SqlException sql
                                           && sql.Number is DuplicateKeyInUniqueIndex or UniqueConstraintViolation)
        {
            ChangeTracker.Clear();
            throw new ConflictException(sql.Message.Contains(UserConfiguration.EmailIndexName, StringComparison.Ordinal)
                ? "A user with this email address already exists."
                : "The record conflicts with an existing record.");
        }
    }

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder) =>
        configurationBuilder.ApplyUtcDateTimeConvention();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
        modelBuilder.ApplySoftDeleteFilter();
    }
}
