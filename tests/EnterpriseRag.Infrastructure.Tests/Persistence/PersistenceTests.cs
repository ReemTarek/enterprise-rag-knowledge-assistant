using EnterpriseRag.Domain.Audit;
using EnterpriseRag.Domain.Common;
using EnterpriseRag.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace EnterpriseRag.Infrastructure.Tests.Persistence;

[Collection(SqlServerCollection.Name)]
public sealed class PersistenceTests(SqlServerFixture fixture)
{
    private static readonly DateTime FixedNow = new(2026, 1, 2, 3, 4, 5, DateTimeKind.Utc);

    private TestDbContext NewTestContext(string cs, DateTime now, string? user = "u1")
    {
        var options = new DbContextOptionsBuilder<TestDbContext>()
            .UseSqlServer(cs)
            .AddInterceptors(new AuditableEntityInterceptor(new FakeDateTimeProvider(now), new FakeCurrentUser(user)))
            .Options;
        return new TestDbContext(options);
    }

    private AppDbContext NewAppContext(string cs)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlServer(cs)
            .AddInterceptors(new AuditLogAppendOnlyInterceptor())
            .Options;
        return new AppDbContext(options);
    }

    [Fact]
    public async Task SaveChanges_SetsCreatedAtFromDateTimeProvider()
    {
        var cs = fixture.NewDatabaseConnectionString();
        await using var ctx = NewTestContext(cs, FixedNow);
        await ctx.Database.EnsureCreatedAsync();

        var item = new TestSoftDeletable { Id = Guid.NewGuid(), Name = "a" };
        ctx.Items.Add(item);
        await ctx.SaveChangesAsync();

        Assert.Equal(FixedNow, item.CreatedAt);
        Assert.Equal("u1", item.CreatedBy);
        Assert.Null(item.UpdatedAt);

        var later = FixedNow.AddHours(1);
        await using var ctx2 = NewTestContext(cs, later, "u2");
        var loaded = await ctx2.Items.SingleAsync();
        loaded.Name = "b";
        await ctx2.SaveChangesAsync();

        Assert.Equal(later, loaded.UpdatedAt);
        Assert.Equal("u2", loaded.UpdatedBy);
        Assert.Equal("u1", loaded.CreatedBy);
    }

    [Fact]
    public async Task SoftDeletedEntity_IsExcludedFromDefaultQuery_ButVisibleWithIgnoreQueryFilters()
    {
        var cs = fixture.NewDatabaseConnectionString();
        await using var ctx = NewTestContext(cs, FixedNow);
        await ctx.Database.EnsureCreatedAsync();

        var item = new TestSoftDeletable { Id = Guid.NewGuid(), Name = "gone" };
        ctx.Items.Add(item);
        await ctx.SaveChangesAsync();
        item.MarkDeleted(FixedNow);
        await ctx.SaveChangesAsync();

        await using var reader = NewTestContext(cs, FixedNow);
        Assert.Empty(await reader.Items.ToListAsync());
        var all = await reader.Items.IgnoreQueryFilters().ToListAsync();
        var found = Assert.Single(all);
        Assert.True(found.IsDeleted);
    }

    [Fact]
    public async Task AuditLog_RoundTrips()
    {
        var cs = fixture.NewDatabaseConnectionString();
        await using var ctx = NewAppContext(cs);
        await ctx.Database.EnsureCreatedAsync();

        var log = new AuditLog
        {
            Id = Guid.NewGuid(), Action = "Login", ActorId = "u1", TargetType = "User",
            TargetId = "42", OccurredAt = FixedNow, DetailsJson = "{\"ip\":\"1.2.3.4\"}",
        };
        ctx.AuditLogs.Add(log);
        await ctx.SaveChangesAsync();

        await using var reader = NewAppContext(cs);
        var loaded = await reader.AuditLogs.SingleAsync(a => a.Id == log.Id);
        Assert.Equal("Login", loaded.Action);
        Assert.Equal("u1", loaded.ActorId);
        Assert.Equal("User", loaded.TargetType);
        Assert.Equal("42", loaded.TargetId);
        Assert.Equal(FixedNow, loaded.OccurredAt);
        Assert.Equal(DateTimeKind.Utc, loaded.OccurredAt.Kind);
        Assert.Equal("{\"ip\":\"1.2.3.4\"}", loaded.DetailsJson);
    }

    [Fact]
    public async Task AuditLog_Update_IsRejected()
    {
        var cs = fixture.NewDatabaseConnectionString();
        await using var ctx = NewAppContext(cs);
        await ctx.Database.EnsureCreatedAsync();
        var log = new AuditLog { Id = Guid.NewGuid(), Action = "A", OccurredAt = FixedNow };
        ctx.AuditLogs.Add(log);
        await ctx.SaveChangesAsync();

        log.Action = "B";
        await Assert.ThrowsAsync<InvalidOperationException>(() => ctx.SaveChangesAsync());

        ctx.ChangeTracker.Clear();
        ctx.AuditLogs.Remove(new AuditLog { Id = log.Id, Action = "A", OccurredAt = FixedNow });
        await Assert.ThrowsAsync<InvalidOperationException>(() => ctx.SaveChangesAsync());
    }

    [Fact]
    public async Task AuditableEntity_DatesReloadWithUtcKind()
    {
        var cs = fixture.NewDatabaseConnectionString();
        await using var ctx = NewTestContext(cs, FixedNow);
        await ctx.Database.EnsureCreatedAsync();
        var item = new TestSoftDeletable { Id = Guid.NewGuid(), Name = "a" };
        ctx.Items.Add(item);
        await ctx.SaveChangesAsync();
        item.MarkDeleted(FixedNow);
        await ctx.SaveChangesAsync();

        await using var reader = NewTestContext(cs, FixedNow);
        var loaded = await reader.Items.IgnoreQueryFilters().SingleAsync();
        Assert.Equal(DateTimeKind.Utc, loaded.CreatedAt.Kind);
        Assert.Equal(DateTimeKind.Utc, loaded.DeletedAt!.Value.Kind);
        Assert.Equal(FixedNow, loaded.CreatedAt);
    }

    [Fact]
    public async Task SaveChanges_RejectsNonUtcDateTime()
    {
        var cs = fixture.NewDatabaseConnectionString();
        await using var ctx = NewAppContext(cs);
        await ctx.Database.EnsureCreatedAsync();
        ctx.AuditLogs.Add(new AuditLog
        {
            Id = Guid.NewGuid(), Action = "A", OccurredAt = new DateTime(2026, 1, 2, 3, 4, 5, DateTimeKind.Unspecified),
        });

        await Assert.ThrowsAnyAsync<Exception>(() => ctx.SaveChangesAsync());
    }

    [Fact]
    public async Task Modify_DoesNotChangeCreatedAtOrCreatedBy()
    {
        var cs = fixture.NewDatabaseConnectionString();
        await using var ctx = NewTestContext(cs, FixedNow);
        await ctx.Database.EnsureCreatedAsync();
        ctx.Items.Add(new TestSoftDeletable { Id = Guid.NewGuid(), Name = "a" });
        await ctx.SaveChangesAsync();

        await using var ctx2 = NewTestContext(cs, FixedNow.AddHours(1), "u2");
        var loaded = await ctx2.Items.SingleAsync();
        loaded.Name = "b";
        loaded.CreatedAt = new DateTime(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        loaded.CreatedBy = "attacker";
        await ctx2.SaveChangesAsync();

        await using var reader = NewTestContext(cs, FixedNow);
        var stored = await reader.Items.SingleAsync();
        Assert.Equal("b", stored.Name);
        Assert.Equal(FixedNow, stored.CreatedAt);
        Assert.Equal("u1", stored.CreatedBy);
    }

    [Fact]
    public async Task Migrations_ApplyCleanly_ToEmptyDatabase()
    {
        var cs = fixture.NewDatabaseConnectionString();
        await using var ctx = NewAppContext(cs);
        await ctx.Database.MigrateAsync();

        Assert.Empty(await ctx.Database.GetPendingMigrationsAsync());
        Assert.False(ctx.Database.HasPendingModelChanges());
        Assert.Contains("InitialCreate", (await ctx.Database.GetAppliedMigrationsAsync()).Single());
        Assert.False(await ctx.AuditLogs.AnyAsync());
    }
}
