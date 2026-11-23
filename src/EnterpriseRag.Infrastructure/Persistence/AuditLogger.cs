using System.Text.Json;
using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Domain.Audit;
using Microsoft.EntityFrameworkCore;

namespace EnterpriseRag.Infrastructure.Persistence;

/// <summary>
/// Writes each audit entry through its own short-lived <see cref="AppDbContext"/> built from the scope's options
/// (same connection string and interceptors) and saves it immediately.
/// </summary>
/// <remarks>
/// Using a separate context keeps the caller's unit of work untouched: the audit save never flushes, or fails on,
/// changes the handler has tracked but not saved (e.g. after a concurrency conflict), and the handler's own
/// <c>SaveChangesAsync</c> never carries audit rows. Trade-off: the entry commits independently, so it is not rolled
/// back with an explicit transaction opened on the caller's context — handlers log after their own save.
/// </remarks>
public sealed class AuditLogger(
    DbContextOptions<AppDbContext> options,
    IDateTimeProvider clock,
    ICurrentUserService currentUser) : IAuditLogger
{
    public async Task LogAsync(string action, string? targetType, string? targetId, object? details, CancellationToken cancellationToken)
    {
        await using var context = new AppDbContext(options);
        context.AuditLogs.Add(new AuditLog
        {
            Action = action,
            ActorId = currentUser.UserId,
            TargetType = targetType,
            TargetId = targetId,
            OccurredAt = clock.UtcNow,
            DetailsJson = details is null ? null : JsonSerializer.Serialize(details, details.GetType()),
        });
        await context.SaveChangesAsync(cancellationToken);
    }
}
