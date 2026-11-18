using EnterpriseRag.Domain.Identity;

namespace EnterpriseRag.Application.Abstractions;

public interface ITokenService
{
    AccessToken CreateAccessToken(User user);

    /// <summary>Creates a new random refresh token; only <see cref="RefreshTokenIssue.Hash"/> may be persisted.</summary>
    RefreshTokenIssue CreateRefreshToken();

    string HashRefreshToken(string raw);
}

public sealed record AccessToken(string Value, DateTime ExpiresAtUtc);

public sealed record RefreshTokenIssue(string Raw, string Hash, DateTime ExpiresAtUtc);
