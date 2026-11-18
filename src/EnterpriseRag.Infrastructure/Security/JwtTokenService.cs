using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;
using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Domain.Identity;
using EnterpriseRag.Shared.Options;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace EnterpriseRag.Infrastructure.Security;

/// <summary>
/// Issues HS256 access tokens (claims <c>sub</c>, <c>role</c>, <c>jti</c>) and opaque refresh tokens
/// (64 random bytes, base64url). Only the SHA-256 hash of a refresh token is ever persisted.
/// </summary>
public sealed class JwtTokenService(IOptions<JwtOptions> options, IDateTimeProvider clock) : ITokenService
{
    public const string RoleClaim = "role";
    public const int RefreshTokenBytes = 64;

    private readonly JwtOptions _options = options.Value;
    private readonly JsonWebTokenHandler _handler = new() { SetDefaultTimesOnTokenCreation = false };

    public AccessToken CreateAccessToken(User user)
    {
        var now = clock.UtcNow;
        var expires = now.AddMinutes(_options.AccessTokenMinutes);
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.SigningKey));
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = _options.Issuer,
            Audience = _options.Audience,
            IssuedAt = now,
            NotBefore = now,
            Expires = expires,
            Claims = new Dictionary<string, object>
            {
                [JwtRegisteredClaimNames.Sub] = user.Id.ToString(),
                [RoleClaim] = user.GlobalRole.ToString(),
                [JwtRegisteredClaimNames.Jti] = Guid.NewGuid().ToString(),
            },
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256),
        };

        return new AccessToken(_handler.CreateToken(descriptor), expires);
    }

    public RefreshTokenIssue CreateRefreshToken()
    {
        var raw = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(RefreshTokenBytes));
        return new RefreshTokenIssue(raw, HashRefreshToken(raw), clock.UtcNow.AddDays(_options.RefreshTokenDays));
    }

    public string HashRefreshToken(string raw) =>
        Base64Url.EncodeToString(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));
}
