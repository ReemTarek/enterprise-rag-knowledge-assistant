using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Domain.Common;
using EnterpriseRag.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EnterpriseRag.Infrastructure.Tests.Persistence;

public sealed class FakeDateTimeProvider(DateTime utcNow) : IDateTimeProvider
{
    public DateTime UtcNow { get; set; } = utcNow;
}

public sealed class FakeCurrentUser(string? userId) : ICurrentUserService
{
    public string? UserId { get; } = userId;

    public Guid? UserGuid => Guid.TryParse(UserId, out var id) ? id : null;

    public bool IsAdmin => false;
}

public sealed class TestSoftDeletable : SoftDeletableEntity
{
    public string Name { get; set; } = string.Empty;
}

public sealed class TestDbContext(DbContextOptions<TestDbContext> options) : DbContext(options)
{
    public DbSet<TestSoftDeletable> Items => Set<TestSoftDeletable>();

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder) =>
        configurationBuilder.ApplyUtcDateTimeConvention();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<TestSoftDeletable>(b => b.HasKey(e => e.Id));
        modelBuilder.ApplySoftDeleteFilter();
    }
}
