using EnterpriseRag.Domain.Audit;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace EnterpriseRag.Infrastructure.Persistence;

/// <summary>Rejects any attempt to modify or delete AuditLog rows.</summary>
public sealed class AuditLogAppendOnlyInterceptor : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Guard(eventData.Context);
        return result;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        Guard(eventData.Context);
        return ValueTask.FromResult(result);
    }

    // Note: bulk ExecuteUpdate/ExecuteDelete and raw SQL bypass this guard (the intended retention-purge path); DB-level enforcement is planned for Phase 10.
    private static void Guard(DbContext? context)
    {
        if (context is null)
        {
            return;
        }

        if (context.ChangeTracker.Entries<AuditLog>()
            .Any(e => e.State is EntityState.Modified or EntityState.Deleted))
        {
            throw new InvalidOperationException("AuditLog entries are append-only and cannot be modified or deleted.");
        }
    }
}
