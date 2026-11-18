using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Application.Common;
using EnterpriseRag.Application.Security;

namespace EnterpriseRag.Application.Auth;

public sealed record RefreshCommand(string RefreshToken);

/// <summary>
/// Rotating refresh: a valid token is revoked and replaced by a new one in the same family. Presenting a token that
/// was already revoked/rotated is treated as theft and revokes the whole family.
/// </summary>
public sealed class RefreshHandler(
    IAppDbContext db,
    IAsyncQueryExecutor query,
    ITokenService tokens,
    IDateTimeProvider clock,
    IAuditLogger audit)
{
    public async Task<AuthResult> HandleAsync(RefreshCommand command, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(command.RefreshToken))
        {
            throw new AuthenticationFailedException();
        }

        var now = clock.UtcNow;
        var hash = tokens.HashRefreshToken(command.RefreshToken);
        var token = await query.FirstOrDefaultAsync(db.RefreshTokens.Where(t => t.TokenHash == hash), ct)
            ?? throw new AuthenticationFailedException();

        if (token.RevokedAt is not null)
        {
            await TokenIssuer.RevokeFamilyAsync(db, query, token.FamilyId, now, ct);
            await db.SaveChangesAsync(ct);
            await audit.LogAsync(AuditActions.RefreshTokenReuseDetected, AuditTargets.User, token.UserId.ToString(),
                new { familyId = token.FamilyId }, ct);
            throw new AuthenticationFailedException();
        }

        if (token.ExpiresAt <= now)
        {
            throw new AuthenticationFailedException();
        }

        var user = await query.FirstOrDefaultAsync(db.Users.Where(u => u.Id == token.UserId && !u.IsDeleted), ct);
        if (user is null || !user.IsActive)
        {
            await TokenIssuer.RevokeFamilyAsync(db, query, token.FamilyId, now, ct);
            await db.SaveChangesAsync(ct);
            throw new AuthenticationFailedException();
        }

        var next = tokens.CreateRefreshToken();
        token.RevokedAt = now;
        token.ReplacedByTokenHash = next.Hash;
        var result = TokenIssuer.Issue(db, tokens, user, token.FamilyId, next);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(AuditActions.TokenRefreshed, AuditTargets.User, user.Id.ToString(), new { familyId = token.FamilyId }, ct);
        return result;
    }
}

public sealed record LogoutCommand(string? RefreshToken);

/// <summary>Revokes the whole family of the presented refresh token. Unknown or missing tokens succeed silently.</summary>
public sealed class LogoutHandler(
    IAppDbContext db,
    IAsyncQueryExecutor query,
    ITokenService tokens,
    IDateTimeProvider clock,
    IAuditLogger audit)
{
    public async Task HandleAsync(LogoutCommand command, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(command.RefreshToken))
        {
            return;
        }

        var hash = tokens.HashRefreshToken(command.RefreshToken);
        var token = await query.FirstOrDefaultAsync(db.RefreshTokens.Where(t => t.TokenHash == hash), ct);
        if (token is null)
        {
            return;
        }

        await TokenIssuer.RevokeFamilyAsync(db, query, token.FamilyId, clock.UtcNow, ct);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(AuditActions.Logout, AuditTargets.User, token.UserId.ToString(), new { familyId = token.FamilyId }, ct);
    }
}
