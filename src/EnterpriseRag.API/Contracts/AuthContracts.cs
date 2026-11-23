using EnterpriseRag.Application.Auth;
using EnterpriseRag.Application.Users;

namespace EnterpriseRag.API.Contracts;

public sealed record LoginRequest(string Email, string Password);

/// <summary>Login/refresh response. The refresh token is only ever sent as the HttpOnly cookie.</summary>
public sealed record AccessTokenResponse(string AccessToken, DateTime ExpiresAtUtc, bool MustChangePassword)
{
    public static AccessTokenResponse From(AuthResult result) =>
        new(result.AccessToken, result.AccessTokenExpiresAtUtc, result.MustChangePassword);
}

public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public sealed record MeResponse(Guid Id, string Email, string DisplayName, string GlobalRole, bool MustChangePassword)
{
    public static MeResponse From(CurrentUserDto user) =>
        new(user.Id, user.Email, user.DisplayName, user.GlobalRole.ToString(), user.MustChangePassword);
}
