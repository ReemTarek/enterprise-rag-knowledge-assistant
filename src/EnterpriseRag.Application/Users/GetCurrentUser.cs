using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Application.Security;
using EnterpriseRag.Domain.Identity;

namespace EnterpriseRag.Application.Users;

/// <summary>The signed-in user's own profile.</summary>
public sealed record CurrentUserDto(Guid Id, string Email, string DisplayName, GlobalRole GlobalRole, bool MustChangePassword);

public sealed class GetCurrentUserHandler(IAppDbContext db, IAsyncQueryExecutor query, ICurrentUserService currentUser)
{
    public async Task<CurrentUserDto> HandleAsync(CancellationToken ct)
    {
        var userId = currentUser.RequireUserId();
        return await query.FirstOrDefaultAsync(
                db.Users
                    .Where(u => u.Id == userId && u.IsActive && !u.IsDeleted)
                    .Select(u => new CurrentUserDto(u.Id, u.Email, u.DisplayName, u.GlobalRole, u.MustChangePassword)),
                ct)
            ?? throw new NotFoundException("User not found.");
    }
}
