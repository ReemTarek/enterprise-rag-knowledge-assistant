using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Application.Auth;
using EnterpriseRag.Application.Common;
using EnterpriseRag.Application.Security;
using EnterpriseRag.Domain.Identity;
using FluentValidation;

namespace EnterpriseRag.Application.Users;

public sealed record CreateUserCommand(string Email, string DisplayName, GlobalRole GlobalRole);

/// <summary>The temporary password is returned once to the admin and is never persisted or logged in clear.</summary>
public sealed record CreatedUserResult(Guid Id, string Email, string TemporaryPassword);

public sealed record UserSummaryDto(
    Guid Id, string Email, string DisplayName, GlobalRole GlobalRole, bool IsActive, bool MustChangePassword, DateTime? LockoutEndUtc);

public sealed record ListUsersQuery(int Page, int PageSize);

public sealed record DeactivateUserCommand(Guid UserId);

public sealed record ResetPasswordCommand(Guid UserId);

public sealed record ResetPasswordResult(string TemporaryPassword);

public sealed class CreateUserValidator : AbstractValidator<CreateUserCommand>
{
    public const int MaxEmailLength = 256;
    public const int MaxDisplayNameLength = 200;

    public CreateUserValidator()
    {
        RuleFor(c => c.Email).NotEmpty().MaximumLength(MaxEmailLength).EmailAddress();
        RuleFor(c => c.DisplayName)
            .Must(n => !string.IsNullOrWhiteSpace(n)).WithMessage("Display name is required.")
            .MaximumLength(MaxDisplayNameLength);
        RuleFor(c => c.GlobalRole).IsInEnum();
    }
}

public sealed class CreateUserHandler(
    IAppDbContext db,
    IAsyncQueryExecutor query,
    IPasswordHasher hasher,
    ICurrentUserService currentUser,
    IAuditLogger audit)
{
    private static readonly CreateUserValidator Validator = new();

    public async Task<CreatedUserResult> HandleAsync(CreateUserCommand command, CancellationToken ct)
    {
        currentUser.RequireAdmin();
        var email = (command.Email ?? string.Empty).Trim().ToLowerInvariant();
        await Validator.ValidateAndThrowAsync(command with { Email = email }, ct);

        if (await query.AnyAsync(db.Users.Where(u => u.Email == email && !u.IsDeleted), ct))
        {
            throw new ConflictException("A user with this email already exists.");
        }

        var temporaryPassword = hasher.GenerateTemporaryPassword();
        var user = User.Create(email, command.DisplayName, hasher.Hash(temporaryPassword), command.GlobalRole, mustChangePassword: true);
        db.Add(user);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(AuditActions.UserCreated, AuditTargets.User, user.Id.ToString(),
            new { email = user.Email, globalRole = user.GlobalRole.ToString() }, ct);

        return new CreatedUserResult(user.Id, user.Email, temporaryPassword);
    }
}

public sealed class ListUsersHandler(IAppDbContext db, IAsyncQueryExecutor query, ICurrentUserService currentUser)
{
    public async Task<PagedResult<UserSummaryDto>> HandleAsync(ListUsersQuery request, CancellationToken ct)
    {
        currentUser.RequireAdmin();
        var (page, pageSize, skip) = Paging.Normalize(request.Page, request.PageSize);

        var users = db.Users.Where(u => !u.IsDeleted);
        var total = await query.CountAsync(users, ct);
        var items = await query.ToListAsync(
            users.OrderBy(u => u.Email).Skip(skip).Take(pageSize)
                .Select(u => new UserSummaryDto(u.Id, u.Email, u.DisplayName, u.GlobalRole, u.IsActive, u.MustChangePassword, u.LockoutEndUtc)),
            ct);

        return new PagedResult<UserSummaryDto>(items, page, pageSize, total);
    }
}

/// <summary>Deactivates a user and revokes all their refresh tokens. Admins cannot deactivate themselves.</summary>
public sealed class DeactivateUserHandler(
    IAppDbContext db,
    IAsyncQueryExecutor query,
    ICurrentUserService currentUser,
    IDateTimeProvider clock,
    IAuditLogger audit)
{
    public async Task HandleAsync(DeactivateUserCommand command, CancellationToken ct)
    {
        var adminId = currentUser.RequireAdmin();
        if (command.UserId == adminId)
        {
            throw new ConflictException("You cannot deactivate your own account.");
        }

        var user = await query.FirstOrDefaultAsync(db.Users.Where(u => u.Id == command.UserId && !u.IsDeleted), ct)
            ?? throw new NotFoundException("User not found.");

        user.Deactivate();
        await TokenIssuer.RevokeAllForUserAsync(db, query, user.Id, clock.UtcNow, ct);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(AuditActions.UserDeactivated, AuditTargets.User, user.Id.ToString(), null, ct);
    }
}

/// <summary>Sets a new temporary password (must be changed at next login) and revokes all the user's sessions.</summary>
public sealed class ResetPasswordHandler(
    IAppDbContext db,
    IAsyncQueryExecutor query,
    IPasswordHasher hasher,
    ICurrentUserService currentUser,
    IDateTimeProvider clock,
    IAuditLogger audit)
{
    public async Task<ResetPasswordResult> HandleAsync(ResetPasswordCommand command, CancellationToken ct)
    {
        currentUser.RequireAdmin();
        var user = await query.FirstOrDefaultAsync(db.Users.Where(u => u.Id == command.UserId && !u.IsDeleted), ct)
            ?? throw new NotFoundException("User not found.");

        var temporaryPassword = hasher.GenerateTemporaryPassword();
        user.SetPassword(hasher.Hash(temporaryPassword), mustChange: true);
        user.RegisterSuccessfulLogin(); // an admin reset also lifts any lockout and clears the failed-attempt counter
        await TokenIssuer.RevokeAllForUserAsync(db, query, user.Id, clock.UtcNow, ct);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(AuditActions.PasswordReset, AuditTargets.User, user.Id.ToString(), null, ct);

        return new ResetPasswordResult(temporaryPassword);
    }
}
