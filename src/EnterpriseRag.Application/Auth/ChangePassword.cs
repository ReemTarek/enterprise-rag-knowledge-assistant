using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Application.Common;
using EnterpriseRag.Application.Security;
using EnterpriseRag.Shared.Options;
using FluentValidation;
using FluentValidation.Results;

namespace EnterpriseRag.Application.Auth;

public sealed record ChangePasswordCommand(string CurrentPassword, string NewPassword);

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

        user.SetPassword(hasher.Hash(command.NewPassword), mustChange: false);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(AuditActions.PasswordChanged, AuditTargets.User, user.Id.ToString(), null, ct);
    }
}
