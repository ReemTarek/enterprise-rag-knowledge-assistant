using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Domain.Identity;
using EnterpriseRag.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Testcontainers.MsSql;

namespace EnterpriseRag.API.IntegrationTests.Support;

/// <summary>
/// One SQL Server container and one migrated database shared by every API test that needs persistence. Tests isolate
/// themselves with unique e-mail addresses and create a fresh <see cref="ApiFactory"/> each (so the in-memory rate
/// limiter starts empty per test).
/// </summary>
public sealed class ApiDatabaseFixture : IAsyncLifetime
{
    public const string AdminEmail = "admin@api-tests.local";
    public const string AdminPassword = "Seeded-Admin-Pass-1";

    private readonly MsSqlContainer _container =
        new MsSqlBuilder("mcr.microsoft.com/mssql/server:2022-CU14-ubuntu-22.04").Build();

    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(_container.GetConnectionString())
        {
            InitialCatalog = "api_tests",
        }.ConnectionString;

        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(ConnectionString).Options);
        await db.Database.MigrateAsync();
    }

    public Task DisposeAsync() => _container.DisposeAsync().AsTask();

    public ApiFactory CreateFactory() => new(connectionString: ConnectionString);

    public static string UniqueEmail(string prefix) => $"{prefix}-{Guid.NewGuid():N}@example.com";

    /// <summary>Creates an active user directly through the persistence layer (no admin endpoint exists yet).</summary>
    public static async Task<Guid> CreateUserAsync(
        ApiFactory factory, string email, string password, GlobalRole role = GlobalRole.User, bool mustChangePassword = false)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher>();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = User.Create(email, "Test User", hasher.Hash(password), role, mustChangePassword);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    }

    public static async Task<T> WithDbAsync<T>(ApiFactory factory, Func<AppDbContext, Task<T>> action)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }
}

[CollectionDefinition(Name)]
public sealed class ApiDatabaseCollection : ICollectionFixture<ApiDatabaseFixture>
{
    public const string Name = "ApiDatabase";
}
