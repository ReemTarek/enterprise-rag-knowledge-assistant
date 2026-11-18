using EnterpriseRag.Application.Abstractions;

namespace EnterpriseRag.API.Auth;

/// <summary>
/// Runs on every authenticated request (JwtBearer <c>OnTokenValidated</c>). A token is accepted only while its user
/// exists, is active, is not deleted, and still holds the role named in the token, so deactivation, deletion and
/// demotion take effect immediately instead of after the access token expires. Authorization decisions therefore come
/// from SQL, not from a possibly stale claim. One primary-key lookup per request; caching is a later optimisation.
/// </summary>
public sealed class ActiveUserCheck(IAppDbContext db, IAsyncQueryExecutor query)
{
    public async Task<bool> IsValidAsync(Guid userId, string? tokenRole, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(tokenRole))
        {
            return false;
        }

        var user = await query.FirstOrDefaultAsync(
            db.Users.Where(u => u.Id == userId && u.IsActive && !u.IsDeleted).Select(u => new { u.GlobalRole }), ct);
        return user is not null && string.Equals(user.GlobalRole.ToString(), tokenRole, StringComparison.Ordinal);
    }
}
