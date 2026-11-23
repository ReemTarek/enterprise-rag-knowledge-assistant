using EnterpriseRag.Application.Abstractions;

namespace EnterpriseRag.Application.Security;

public static class CurrentUserExtensions
{
    /// <summary>Returns the caller's id or throws <see cref="AccessDeniedException"/> when unauthenticated.</summary>
    public static Guid RequireUserId(this ICurrentUserService currentUser) =>
        currentUser.UserGuid ?? throw new AccessDeniedException("Authentication required.");

    /// <summary>Returns the caller's id when they hold the global Admin role; otherwise throws <see cref="AccessDeniedException"/>.</summary>
    public static Guid RequireAdmin(this ICurrentUserService currentUser)
    {
        var id = currentUser.RequireUserId();
        if (!currentUser.IsAdmin)
        {
            throw new AccessDeniedException();
        }

        return id;
    }
}
