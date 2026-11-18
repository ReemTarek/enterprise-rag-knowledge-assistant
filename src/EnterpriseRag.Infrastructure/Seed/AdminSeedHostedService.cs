using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Application.Common;
using EnterpriseRag.Domain.Identity;
using EnterpriseRag.Infrastructure.Persistence;
using EnterpriseRag.Shared.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace EnterpriseRag.Infrastructure.Seed;

/// <summary>
/// Creates the first administrator at startup when the database has no live users. It never runs migrations:
/// an unreachable or not-yet-migrated database only logs a warning. A reachable, migrated, empty database without
/// valid <c>Seed</c> configuration fails startup, so a deployment can never come up with no way to sign in.
/// </summary>
public sealed partial class AdminSeedHostedService(
    IServiceScopeFactory scopeFactory,
    IOptions<SeedOptions> seedOptions,
    SecurityOptions security,
    ILogger<AdminSeedHostedService> logger) : IHostedService
{
    public const string AdminDisplayName = "Administrator";

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        if (!await CanConnectAsync(db, cancellationToken))
        {
            LogDatabaseUnreachable(logger);
            return;
        }

        if ((await db.Database.GetPendingMigrationsAsync(cancellationToken)).Any())
        {
            LogPendingMigrations(logger);
            return;
        }

        // The soft-delete filter applies: only live users count.
        if (await db.Users.AnyAsync(cancellationToken))
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

    [LoggerMessage(Level = LogLevel.Warning, Message = "Admin seed skipped: the database has pending migrations. Apply migrations and restart.")]
    private static partial void LogPendingMigrations(ILogger logger);

    [LoggerMessage(Level = LogLevel.Information, Message = "Admin seed skipped: another instance created the administrator.")]
    private static partial void LogAlreadySeeded(ILogger logger);

    [LoggerMessage(Level = LogLevel.Information, Message = "Seeded initial administrator {UserId}; the password must be changed at first sign-in.")]
    private static partial void LogSeeded(ILogger logger, Guid userId);
}
