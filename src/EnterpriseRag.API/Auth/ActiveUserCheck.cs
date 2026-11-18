using EnterpriseRag.Application.Abstractions;

namespace EnterpriseRag.API.Auth;

/// <summary>
/// Runs on every authenticated request (JwtBearer <c>OnTokenValidated</c>) so a deactivated or deleted user's
/// still-unexpired access token stops working immediately. One indexed primary-key lookup per request; caching is a
/// later optimisation.
/// </summary>
public sealed class ActiveUserCheck(IAppDbContext db, IAsyncQueryExecutor query)
{
    public Task<bool> IsActiveAsync(Guid userId, CancellationToken ct) =>
        query.AnyAsync(db.Users.Where(u => u.Id == userId && u.IsActive && !u.IsDeleted), ct);
}
