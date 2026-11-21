using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Domain.Identity;
using EnterpriseRag.Infrastructure.Persistence;
using EnterpriseRag.Infrastructure.Seed;
using EnterpriseRag.Infrastructure.Tests.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace EnterpriseRag.Infrastructure.Tests.Seed;

[Collection(SqlServerCollection.Name)]
public sealed class AdminSeedTests(SqlServerFixture fixture)
{
    private static readonly DateTime FixedNow = new(2026, 5, 6, 7, 8, 9, DateTimeKind.Utc);
    private const string Password = "Initial-Admin-Pass-1";

    private ServiceProvider Build(Dictionary<string, string?> seed, string? connectionString = null) =>
        InfrastructureHarness.Build(connectionString ?? fixture.NewDatabaseConnectionString(), new FakeDateTimeProvider(FixedNow), seed);

    private static AdminSeedHostedService Seeder(IServiceProvider sp) =>
        sp.GetServices<IHostedService>().OfType<AdminSeedHostedService>().Single();

    private static Dictionary<string, string?> Seed(string? email = "Admin@Example.com", string? password = Password) => new()
    {
        ["Seed:AdminEmail"] = email,
        ["Seed:AdminPassword"] = password,
    };

    [Fact]
    public async Task AdminSeed_EmptyDb_CreatesAdminOnce()
    {
        await using var sp = Build(Seed());
        await InfrastructureHarness.MigrateAsync(sp);

        await Seeder(sp).StartAsync(CancellationToken.None);
        await Seeder(sp).StartAsync(CancellationToken.None);

        await using var scope = sp.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var admin = await db.Users.SingleAsync();
        Assert.Equal("admin@example.com", admin.Email);
        Assert.Equal(GlobalRole.Admin, admin.GlobalRole);
        Assert.True(admin.IsActive);
        Assert.True(admin.MustChangePassword);
        Assert.NotEqual(Password, admin.PasswordHash);
        Assert.True(scope.ServiceProvider.GetRequiredService<IPasswordHasher>().Verify(admin.PasswordHash, Password));
    }

    [Theory]
    [InlineData(null, Password)]
    [InlineData("admin@example.com", null)]
    [InlineData("", "")]
    [InlineData("admin@example.com", "Short-1")]
    [InlineData("admin@example.com", "Aa1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")] // 129 characters
    public async Task AdminSeed_EmptyDb_MissingConfig_FailsStartupWithClearMessage(string? email, string? password)
    {
        await using var sp = Build(Seed(email, password));
        await InfrastructureHarness.MigrateAsync(sp);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => Seeder(sp).StartAsync(CancellationToken.None));

        Assert.Contains("Seed:AdminEmail", ex.Message);
        Assert.Contains("Seed:AdminPassword", ex.Message);
        if (!string.IsNullOrEmpty(password))
        {
            Assert.DoesNotContain(password, ex.Message);
        }

        await using var scope = sp.CreateAsyncScope();
        Assert.False(await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AnyAsync());
    }

    [Fact]
    public async Task AdminSeed_UsersExist_DoesNothing()
    {
        await using var sp = Build(Seed(email: null, password: null));
        await InfrastructureHarness.MigrateAsync(sp);
        await using (var scope = sp.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Users.Add(User.Create("existing@example.com", "Existing", "hash", GlobalRole.User, false));
            await db.SaveChangesAsync();
        }

        // Missing config is fine once users exist.
        await Seeder(sp).StartAsync(CancellationToken.None);

        await using var reader = sp.CreateAsyncScope();
        var user = await reader.ServiceProvider.GetRequiredService<AppDbContext>().Users.SingleAsync();
        Assert.Equal("existing@example.com", user.Email);
    }

    [Fact]
    public async Task AdminSeed_OnlySoftDeletedUsers_CreatesAdmin()
    {
        await using var sp = Build(Seed());
        await InfrastructureHarness.MigrateAsync(sp);
        await using (var scope = sp.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var gone = User.Create("gone@example.com", "Gone", "hash", GlobalRole.Admin, false);
            gone.MarkDeleted(FixedNow);
            db.Users.Add(gone);
            await db.SaveChangesAsync();
        }

        await Seeder(sp).StartAsync(CancellationToken.None);

        await using var reader = sp.CreateAsyncScope();
        Assert.Equal("admin@example.com", (await reader.ServiceProvider.GetRequiredService<AppDbContext>().Users.SingleAsync()).Email);
    }

    [Fact]
    public async Task AdminSeed_DatabaseUnreachable_DoesNotThrow()
    {
        await using var sp = Build(
            Seed(email: null, password: null),
            "Server=127.0.0.1,1;Database=Fake;User Id=x;Password=x;Connect Timeout=2;TrustServerCertificate=True");

        await Seeder(sp).StartAsync(CancellationToken.None);
    }

    [Fact]
    public async Task AdminSeed_PartiallyMigrated_UsersTableExists_EmptyAndMissingConfig_Throws()
    {
        // A later migration is pending, but the Users table is there and empty: a deployment that comes up like this
        // would have no way to sign in, so startup must fail (the old gate silently skipped on any pending migration).
        await using var sp = Build(Seed(email: null, password: null));
        await InfrastructureHarness.MigrateAsync(sp);
        await using (var scope = sp.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var latest = db.Database.GetMigrations().Last();
            await db.Database.ExecuteSqlAsync($"DELETE FROM [__EFMigrationsHistory] WHERE [MigrationId] = {latest}");
            Assert.NotEmpty(await db.Database.GetPendingMigrationsAsync());
        }

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => Seeder(sp).StartAsync(CancellationToken.None));

        Assert.Contains("Seed:AdminEmail", ex.Message);
    }

    [Fact]
    public async Task AdminSeed_SchemaBehind_UsersTableMissing_DoesNotThrow()
    {
        await using var sp = Build(Seed(email: null, password: null));
        await using (var scope = sp.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            // Only the first migration (AuditLogs): the database exists but has no Users table yet.
            await db.GetService<IMigrator>().MigrateAsync(db.Database.GetMigrations().First());
        }

        await Seeder(sp).StartAsync(CancellationToken.None);
    }

    [Fact]
    public async Task AdminSeed_DatabaseNotMigrated_DoesNotThrow()
    {
        await using var sp = Build(Seed(email: null, password: null));

        await Seeder(sp).StartAsync(CancellationToken.None);
    }
}
