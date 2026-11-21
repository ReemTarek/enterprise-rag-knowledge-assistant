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
    /// <summary>The password the admin is SEEDED with (mustChangePassword = true).</summary>
    public const string AdminPassword = "Seeded-Admin-Pass-1";

    /// <summary>
    /// The seeded admin's password after the fixture's one-time change. The server blocks a must-change user from
    /// everything but the password change and /api/me, so tests that act as the admin use this password. Tests about
    /// the seeded (must-change) state itself use <see cref="CreateDatabaseAsync"/> for a fresh database.
    /// </summary>
    public const string AdminWorkingPassword = "Working-Admin-Pass-2";

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

        await MigrateAsync(ConnectionString);
        await EnsureSeededAdminPasswordChangedAsync();
    }

    /// <summary>
    /// Starts the API once (which seeds the admin) and changes the seeded admin's password from
    /// <see cref="AdminPassword"/> to <see cref="AdminWorkingPassword"/> through the real endpoints. Idempotent: if the
    /// seed password no longer works, the change already happened.
    /// </summary>
    private async Task EnsureSeededAdminPasswordChangedAsync()
    {
        await using var factory = CreateFactory();
        using var client = AuthHttp.CreateClient(factory);
        var login = await AuthHttp.LoginAsync(client, AdminEmail, AdminPassword);
        if (login.Response.StatusCode != System.Net.HttpStatusCode.OK)
        {
            return;
        }

        var change = await AuthHttp.SendAsync(client, HttpMethod.Post, "/api/auth/password", login.AccessToken, login.RefreshToken,
            new { currentPassword = AdminPassword, newPassword = AdminWorkingPassword });
        if (change.StatusCode != System.Net.HttpStatusCode.NoContent)
        {
            throw new InvalidOperationException($"Changing the seeded admin password failed: {change.StatusCode}");
        }
    }

    /// <summary>Logs the (already password-changed) seeded admin in; returns the access token.</summary>
    public static async Task<string> AdminTokenAsync(HttpClient client)
    {
        var login = await AuthHttp.LoginAsync(client, AdminEmail, AdminWorkingPassword);
        if (login.Response.StatusCode != System.Net.HttpStatusCode.OK)
        {
            throw new InvalidOperationException($"Admin login failed: {login.Response.StatusCode}");
        }

        return login.AccessToken;
    }

    /// <summary>Creates and migrates a separate, empty database in the same container; returns its connection string.</summary>
    public async Task<string> CreateDatabaseAsync(string name)
    {
        var connectionString = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(ConnectionString)
        {
            InitialCatalog = $"{name}_{Guid.NewGuid():N}",
        }.ConnectionString;
        await MigrateAsync(connectionString);
        return connectionString;
    }

    private static async Task MigrateAsync(string connectionString)
    {
        await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connectionString).Options);
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
