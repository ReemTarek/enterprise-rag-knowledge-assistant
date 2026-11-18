namespace EnterpriseRag.Application.Abstractions;

/// <summary>
/// Writes an append-only audit entry for the current actor. The implementation persists the entry itself
/// (handlers call it after their own <c>SaveChangesAsync</c>, or before throwing for failed sign-ins).
/// <paramref name="details"/> must never contain passwords, tokens or hashes.
/// </summary>
public interface IAuditLogger
{
    Task LogAsync(string action, string? targetType, string? targetId, object? details, CancellationToken cancellationToken);
}
