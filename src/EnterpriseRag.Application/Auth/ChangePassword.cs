using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Application.Common;
using EnterpriseRag.Application.Security;
using EnterpriseRag.Shared.Options;
using FluentValidation;
using FluentValidation.Results;

namespace EnterpriseRag.Application.Auth;

/// <param name="CurrentRefreshTokenRaw">
/// The caller's refresh cookie, if any. Its family (the current device) stays signed in; every other refresh token of
/// the user is revoked. Ignored when it is unknown, revoked, expired or belongs to someone else.
/// </param>
public sealed record ChangePasswordCommand(string CurrentPassword, string NewPassword, string? CurrentRefreshTokenRaw = null);

public sealed class ChangePasswordValidator : AbstractValidator<ChangePasswordCommand>
{
    public ChangePasswordValidator(SecurityOptions security)
    {
        RuleFor(c => c.CurrentPassword).NotEmpty();
        RuleFor(c => c.NewPassword).ApplyPasswordPolicy(security.MinPasswordLength);
        RuleFor(c => c.NewPassword)
            .NotEqual(c => c.CurrentPassword).WithMessage("The new password must differ from the current password.");
    }
}

public static class PasswordPolicy
{
    public static IRuleBuilderOptions<T, string> ApplyPasswordPolicy<T>(this IRuleBuilder<T, string> rule, int minLength) =>
        rule.NotEmpty()
            .MinimumLength(minLength)
            .Matches("[A-Z]").WithMessage("Password must contain an upper-case letter.")
            .Matches("[a-z]").WithMessage("Password must contain a lower-case letter.")
            .Matches("[0-9]").WithMessage("Password must contain a digit.");
}

public sealed class ChangePasswordHandler(
    IAppDbContext db,
    IAsyncQueryExecutor query,
    IPasswordHasher hasher,
    ITokenService tokens,
    IDateTimeProvider clock,
    ICurrentUserService currentUser,
    SecurityOptions security,
    IAuditLogger audit)
{
    public async Task HandleAsync(ChangePasswordCommand command, CancellationToken ct)
    {
        var userId = currentUser.RequireUserId();
        await new ChangePasswordValidator(security).ValidateAndThrowAsync(command, ct);

        var user = await query.FirstOrDefaultAsync(db.Users.Where(u => u.Id == userId && !u.IsDeleted && u.IsActive), ct)
            ?? throw new AuthenticationFailedException();

        if (!hasher.Verify(user.PasswordHash, command.CurrentPassword))
        {
            throw new ValidationException(
                [new ValidationFailure(nameof(ChangePasswordCommand.CurrentPassword), "The current password is incorrect.")]);
        }

        var now = clock.UtcNow;
        var keepFamily = await CurrentFamilyAsync(command.CurrentRefreshTokenRaw, userId, now, ct);

        user.SetPassword(hasher.Hash(command.NewPassword), mustChange: false);

        // Ruling: a password change ends every other session; the presenting device (its refresh family) stays signed in.
        var others = await query.ToListAsync(
            db.RefreshTokens.Where(t => t.UserId == userId && t.RevokedAt == null && t.FamilyId != keepFamily), ct);
        foreach (var token in others)
        {
            token.RevokedAt = now;
        }

        await db.SaveChangesAsync(ct);
        await audit.LogAsync(AuditActions.PasswordChanged, AuditTargets.User, user.Id.ToString(), null, ct);
    }

    /// <summary>The family of the presented refresh token when it is the caller's own, active and unexpired; else null.</summary>
    private async Task<Guid?> CurrentFamilyAsync(string? raw, Guid userId, DateTime now, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var hash = tokens.HashRefreshToken(raw);
        var token = await query.FirstOrDefaultAsync(
            db.RefreshTokens.Where(t => t.TokenHash == hash && t.UserId == userId && t.RevokedAt == null && t.ExpiresAt > now), ct);
        return token?.FamilyId;
    }
}
