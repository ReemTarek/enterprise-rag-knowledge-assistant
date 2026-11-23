using EnterpriseRag.Application.Abstractions;

namespace EnterpriseRag.API.Auth;

/// <summary>What the per-request check learned about a valid token's user (read from SQL, never from the token).</summary>
public sealed record ActiveUserStatus(bool MustChangePassword);

/// <summary>
/// Runs on every authenticated request (JwtBearer <c>OnTokenValidated</c>). A token is accepted only while its user
/// exists, is active, is not deleted, and still holds the role named in the token, so deactivation, deletion and
/// demotion take effect immediately instead of after the access token expires. Authorization decisions therefore come
/// from SQL, not from a possibly stale claim. The same single primary-key lookup also returns
/// <c>MustChangePassword</c>, which drives the must-change-password block. Caching is a later optimisation.
/// </summary>
public sealed class ActiveUserCheck(IAppDbContext db, IAsyncQueryExecutor query)
{
    /// <returns>The user's status when the token is acceptable; <c>null</c> when it must be rejected.</returns>
    public async Task<ActiveUserStatus?> CheckAsync(Guid userId, string? tokenRole, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(tokenRole))
        {
            return null;
        }

        var user = await query.FirstOrDefaultAsync(
            db.Users.Where(u => u.Id == userId && u.IsActive && !u.IsDeleted)
                .Select(u => new { u.GlobalRole, u.MustChangePassword }),
            ct);
        return user is not null && string.Equals(user.GlobalRole.ToString(), tokenRole, StringComparison.Ordinal)
            ? new ActiveUserStatus(user.MustChangePassword)
            : null;
    }
}
