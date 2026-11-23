using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Application.Common;
using EnterpriseRag.Application.Security;
using EnterpriseRag.Domain.Identity;
using EnterpriseRag.Shared.Options;

namespace EnterpriseRag.Application.Auth;

public sealed record LoginCommand(string Email, string Password);

/// <summary>Result of a successful login or refresh. <see cref="RefreshToken"/> is the raw value for the HttpOnly cookie.</summary>
public sealed record AuthResult(
    string AccessToken,
    DateTime AccessTokenExpiresAtUtc,
    string RefreshToken,
    DateTime RefreshTokenExpiresAtUtc,
    bool MustChangePassword);

public sealed class LoginHandler(
    IAppDbContext db,
    IAsyncQueryExecutor query,
    IPasswordHasher hasher,
    ITokenService tokens,
    IDateTimeProvider clock,
    SecurityOptions security,
    IAuditLogger audit)
{
    private static string? s_dummyHash;

    public async Task<AuthResult> HandleAsync(LoginCommand command, CancellationToken ct)
    {
        var email = (command.Email ?? string.Empty).Trim().ToLowerInvariant();
        var password = command.Password ?? string.Empty;
        var now = clock.UtcNow;

        // No account can have a longer password: fail generically without a lookup, a hash or a lockout count.
        if (password.Length > PasswordPolicy.MaxLength)
        {
            await audit.LogAsync(AuditActions.LoginFailed, AuditTargets.User, null, new { reason = "password_too_long" }, ct);
            throw new AuthenticationFailedException();
        }

        var user = email.Length == 0
            ? null
            : await query.FirstOrDefaultAsync(db.Users.Where(u => u.Email == email && !u.IsDeleted), ct);

        // Unknown, inactive and locked-out accounts all burn one hash verification (timing parity) and fail with the
        // same generic error. Locked-out accounts are rejected BEFORE RegisterFailedLogin so attempts during a
        // lockout neither extend it nor count towards the next one.
        if (user is null || !user.IsActive || user.IsLockedOut(now))
        {
            hasher.Verify(DummyHash(), password);
            await audit.LogAsync(AuditActions.LoginFailed, AuditTargets.User, user?.Id.ToString(),
                new { reason = user is null ? "unknown_account" : !user.IsActive ? "inactive" : "locked_out" }, ct);
            throw new AuthenticationFailedException();
        }

        if (!hasher.Verify(user.PasswordHash, password))
        {
            user.RegisterFailedLogin(now, security.MaxFailedLogins, TimeSpan.FromMinutes(security.LockoutMinutes));
            await db.SaveChangesAsync(ct);
            await audit.LogAsync(AuditActions.LoginFailed, AuditTargets.User, user.Id.ToString(),
                new { reason = "invalid_password", lockedOut = user.IsLockedOut(now) }, ct);
            throw new AuthenticationFailedException();
        }

        user.RegisterSuccessfulLogin();
        var result = TokenIssuer.Issue(db, tokens, user, Guid.CreateVersion7(), out _);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(AuditActions.LoginSucceeded, AuditTargets.User, user.Id.ToString(), null, ct);
        return result;
    }

    private string DummyHash() => s_dummyHash ??= hasher.Hash(Guid.NewGuid().ToString("N"));
}

internal static class TokenIssuer
{
    /// <summary>Creates an access token and a new refresh token in <paramref name="familyId"/>; stores only the hash.</summary>
    public static AuthResult Issue(
        IAppDbContext db, ITokenService tokens, User user, Guid familyId, out RefreshToken stored, RefreshTokenIssue? refresh = null)
    {
        var access = tokens.CreateAccessToken(user);
        refresh ??= tokens.CreateRefreshToken();
        stored = new RefreshToken
        {
            UserId = user.Id,
            TokenHash = refresh.Hash,
            FamilyId = familyId,
            ExpiresAt = refresh.ExpiresAtUtc,
        };
        db.Add(stored);
        return new AuthResult(access.Value, access.ExpiresAtUtc, refresh.Raw, refresh.ExpiresAtUtc, user.MustChangePassword);
    }

    /// <summary>Revokes every still-active token of the family; returns how many were revoked.</summary>
    public static async Task<int> RevokeFamilyAsync(
        IAppDbContext db, IAsyncQueryExecutor query, Guid familyId, DateTime now, CancellationToken ct)
    {
        var family = await query.ToListAsync(
            db.RefreshTokens.Where(t => t.FamilyId == familyId && t.RevokedAt == null), ct);
        foreach (var token in family)
        {
            token.RevokedAt = now;
        }

        return family.Count;
    }

    /// <summary>Revokes every still-active refresh token of a user (all sessions).</summary>
    public static async Task RevokeAllForUserAsync(
        IAppDbContext db, IAsyncQueryExecutor query, Guid userId, DateTime now, CancellationToken ct)
    {
        var active = await query.ToListAsync(
            db.RefreshTokens.Where(t => t.UserId == userId && t.RevokedAt == null), ct);
        foreach (var token in active)
        {
            token.RevokedAt = now;
        }
    }
}
