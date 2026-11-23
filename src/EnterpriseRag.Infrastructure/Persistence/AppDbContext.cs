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

    private const string StaleMessage = "The record was modified by another request. Reload it and try again.";

    // Entities whose row version the CLIENT supplied (If-Match). Only their concurrency failures are 412s.
    private readonly HashSet<object> _clientPreconditioned = new(ReferenceEqualityComparer.Instance);

    /// <summary>
    /// Compares the client's row version with the loaded one immediately (EF sends no UPDATE when nothing changed, so
    /// a stale precondition could otherwise pass), then makes it the original value so a change committed between
    /// load and save is caught by the UPDATE's WHERE clause. Either way: <see cref="ConcurrencyConflictException"/>.
    /// </summary>
    public void SetExpectedRowVersion(KnowledgeBase knowledgeBase, byte[] rowVersion)
    {
        var property = Entry(knowledgeBase).Property(k => k.RowVersion);
        if (!property.OriginalValue.AsSpan().SequenceEqual(rowVersion))
        {
            throw new ConcurrencyConflictException(StaleMessage);
        }

        property.OriginalValue = rowVersion;
        _clientPreconditioned.Add(knowledgeBase);
    }

    /// <summary>
    /// Persists tracked changes. A concurrency failure on an entity whose row version the client supplied
    /// (<see cref="SetExpectedRowVersion"/>, i.e. If-Match) surfaces as <see cref="ConcurrencyConflictException"/>
    /// (412); any other concurrency failure (e.g. two concurrent membership changes, a refresh-token rotation race)
    /// and unique-key violations as <see cref="ConflictException"/> (409). In every case the change tracker is
    /// cleared so the failed changes are never re-sent by a later save in the same scope (entities must be
    /// re-queried afterwards).
    /// </summary>
    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        try
        {
            return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
        }
        catch (DbUpdateConcurrencyException ex)
        {
            // Only a client-supplied precondition (If-Match) failing is a 412; losing any other race is a 409.
            var clientPrecondition = ex.Entries.Any(e => _clientPreconditioned.Contains(e.Entity));
            ChangeTracker.Clear();
            _clientPreconditioned.Clear();
            throw clientPrecondition
                ? new ConcurrencyConflictException(StaleMessage)
                : new ConflictException(StaleMessage);
        }
        catch (DbUpdateException ex) when (ex.InnerException is SqlException sql
                                           && sql.Number is DuplicateKeyInUniqueIndex or UniqueConstraintViolation)
        {
            ChangeTracker.Clear();
            _clientPreconditioned.Clear();
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
