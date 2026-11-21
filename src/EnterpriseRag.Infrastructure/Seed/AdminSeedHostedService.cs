using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Application.Common;
using EnterpriseRag.Domain.Identity;
using EnterpriseRag.Infrastructure.Persistence;
using EnterpriseRag.Shared.Options;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace EnterpriseRag.Infrastructure.Seed;

/// <summary>
/// Creates the first administrator at startup when the database has no live users. It never runs migrations: an
/// unreachable database, or one whose schema does not have the Users table yet (SQL errors 207/208), only logs a
/// warning. Otherwise - even with a later migration still pending - an empty Users table without valid <c>Seed</c>
/// configuration fails startup, so a deployment can never come up with no way to sign in.
/// </summary>
public sealed partial class AdminSeedHostedService(
    IServiceScopeFactory scopeFactory,
    IOptions<SeedOptions> seedOptions,
    SecurityOptions security,
    ILogger<AdminSeedHostedService> logger) : IHostedService
{
    public const string AdminDisplayName = "Administrator";

    // SQL Server: 207 = invalid column name, 208 = invalid object name (the schema is missing or behind).
    private const int InvalidColumnName = 207;
    private const int InvalidObjectName = 208;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        if (!await CanConnectAsync(db, cancellationToken))
        {
            LogDatabaseUnreachable(logger);
            return;
        }

        // The soft-delete filter applies: only live users count. No pending-migration gate: a database that already has
        // the Users table is judged by its contents, so a partially migrated, empty one still demands Seed config.
        bool hasUsers;
        try
        {
            hasUsers = await db.Users.AnyAsync(cancellationToken);
        }
        catch (SqlException ex) when (ex.Number is InvalidObjectName or InvalidColumnName)
        {
            LogSchemaMissing(logger);
            return;
        }
        catch (SqlException ex) when (IsConnectivityFailure(ex))
        {
            LogDatabaseUnreachable(logger);
            return;
        }

        if (hasUsers)
        {
            return;
        }

        var seed = seedOptions.Value;
        var email = seed.AdminEmail?.Trim();
        var password = seed.AdminPassword;
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrEmpty(password) || password.Length < security.MinPasswordLength)
        {
            throw new InvalidOperationException(
                "The database has no users, so an initial administrator must be seeded: configure Seed:AdminEmail and " +
                $"Seed:AdminPassword (at least {security.MinPasswordLength} characters) via environment variables " +
                "(Seed__AdminEmail, Seed__AdminPassword) or a secret store.");
        }

        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher>();
        var admin = User.Create(email, AdminDisplayName, hasher.Hash(password), GlobalRole.Admin, mustChangePassword: true);
        db.Users.Add(admin);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (ConflictException)
        {
            // Another instance seeded the same address concurrently.
            LogAlreadySeeded(logger);
            return;
        }

        LogSeeded(logger, admin.Id);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    /// <summary>Network/login-level failures (the connection dropped after the probe): warn, never crash startup.</summary>
    private static bool IsConnectivityFailure(SqlException ex) => ex.Class >= 20 || ex.Number is -2 or 53 or 4060 or 18456 or 10054 or 10060;

    private static async Task<bool> CanConnectAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        try
        {
            return await db.Database.CanConnectAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return false;
        }
    }

    // Messages never include connection details or the password.
    [LoggerMessage(Level = LogLevel.Warning, Message = "Admin seed skipped: the database is unreachable.")]
    private static partial void LogDatabaseUnreachable(ILogger logger);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Admin seed skipped: the Users table does not exist yet. Apply migrations and restart.")]
    private static partial void LogSchemaMissing(ILogger logger);

    [LoggerMessage(Level = LogLevel.Information, Message = "Admin seed skipped: another instance created the administrator.")]
    private static partial void LogAlreadySeeded(ILogger logger);

    [LoggerMessage(Level = LogLevel.Information, Message = "Seeded initial administrator {UserId}; the password must be changed at first sign-in.")]
    private static partial void LogSeeded(ILogger logger, Guid userId);
}
