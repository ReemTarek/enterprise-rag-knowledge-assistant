using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Application.Common;
using EnterpriseRag.Application.Security;
using EnterpriseRag.Domain.Common;
using EnterpriseRag.Domain.KnowledgeBases;
using FluentValidation;

namespace EnterpriseRag.Application.KnowledgeBases;

public sealed record AddMemberCommand(Guid KnowledgeBaseId, Guid UserId, KnowledgeBaseRole Role);

public sealed record ChangeMemberRoleCommand(Guid KnowledgeBaseId, Guid UserId, KnowledgeBaseRole Role);

public sealed record RemoveMemberCommand(Guid KnowledgeBaseId, Guid UserId);

public sealed record ListMembersQuery(Guid KnowledgeBaseId);

public sealed class AddMemberValidator : AbstractValidator<AddMemberCommand>
{
    public AddMemberValidator()
    {
        RuleFor(c => c.UserId).NotEmpty();
        RuleFor(c => c.Role).IsInEnum();
    }
}

public sealed class ChangeMemberRoleValidator : AbstractValidator<ChangeMemberRoleCommand>
{
    public ChangeMemberRoleValidator() => RuleFor(c => c.Role).IsInEnum();
}

internal static class MemberMessages
{
    public const string MemberNotFound = "Member not found.";
    public const string UserNotFound = "User not found.";
}

public sealed class AddMemberHandler(IAppDbContext db, IAsyncQueryExecutor query, IAccessPolicy policy, IAuditLogger audit)
{
    private static readonly AddMemberValidator Validator = new();

    public async Task<KnowledgeBaseMemberDto> HandleAsync(AddMemberCommand command, CancellationToken ct)
    {
        await Validator.ValidateAndThrowAsync(command, ct);
        var kb = await policy.RequireKnowledgeBaseAsync(command.KnowledgeBaseId, KnowledgeBaseRole.Owner, ct);

        var user = await query.FirstOrDefaultAsync(
            db.Users.Where(u => u.Id == command.UserId && !u.IsDeleted && u.IsActive), ct)
            ?? throw new NotFoundException(MemberMessages.UserNotFound);

        if (kb.RoleOf(user.Id) is not null)
        {
            throw new ConflictException("User is already a member of this knowledge base.");
        }

        kb.AddMember(user.Id, command.Role);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(AuditActions.MemberAdded, AuditTargets.KnowledgeBase, kb.Id.ToString(),
            new { userId = user.Id, role = command.Role.ToString() }, ct);
        return new KnowledgeBaseMemberDto(user.Id, user.DisplayName, user.Email, command.Role);
    }
}

/// <summary>
/// Changes a member's role (Owner only). Assigning the role the member already has is a deliberate no-op:
/// nothing is saved, <see cref="KnowledgeBase.PermissionVersion"/> does not change and no audit entry is written.
/// Demoting the last owner is a <see cref="ConflictException"/>.
/// </summary>
public sealed class ChangeMemberRoleHandler(IAppDbContext db, IAsyncQueryExecutor query, IAccessPolicy policy, IAuditLogger audit)
{
    private static readonly ChangeMemberRoleValidator Validator = new();

    public async Task<KnowledgeBaseMemberDto> HandleAsync(ChangeMemberRoleCommand command, CancellationToken ct)
    {
        await Validator.ValidateAndThrowAsync(command, ct);
        var kb = await policy.RequireKnowledgeBaseAsync(command.KnowledgeBaseId, KnowledgeBaseRole.Owner, ct);

        var current = kb.RoleOf(command.UserId) ?? throw new NotFoundException(MemberMessages.MemberNotFound);
        if (current != command.Role)
        {
            try
            {
                kb.ChangeMemberRole(command.UserId, command.Role);
            }
            catch (DomainException ex)
            {
                throw new ConflictException(ex.Message);
            }

            await db.SaveChangesAsync(ct);
            await audit.LogAsync(AuditActions.MemberRoleChanged, AuditTargets.KnowledgeBase, kb.Id.ToString(),
                new { userId = command.UserId, from = current.ToString(), to = command.Role.ToString() }, ct);
        }

        var user = await query.FirstOrDefaultAsync(db.Users.Where(u => u.Id == command.UserId), ct);
        return new KnowledgeBaseMemberDto(command.UserId, user?.DisplayName ?? string.Empty, user?.Email ?? string.Empty, command.Role);
    }
}

/// <summary>Removes a member (Owner only); access is lost immediately. Removing the last owner is a <see cref="ConflictException"/>.</summary>
public sealed class RemoveMemberHandler(IAppDbContext db, IAccessPolicy policy, IAuditLogger audit)
{
    public async Task HandleAsync(RemoveMemberCommand command, CancellationToken ct)
    {
        var kb = await policy.RequireKnowledgeBaseAsync(command.KnowledgeBaseId, KnowledgeBaseRole.Owner, ct);
        if (kb.RoleOf(command.UserId) is null)
        {
            throw new NotFoundException(MemberMessages.MemberNotFound);
        }

        try
        {
            kb.RemoveMember(command.UserId);
        }
        catch (DomainException ex)
        {
            throw new ConflictException(ex.Message);
        }

        await db.SaveChangesAsync(ct);
        await audit.LogAsync(AuditActions.MemberRemoved, AuditTargets.KnowledgeBase, kb.Id.ToString(),
            new { userId = command.UserId }, ct);
    }
}

/// <summary>Lists members with name, email and role; any member (Viewer and up) may call it.</summary>
public sealed class ListMembersHandler(IAppDbContext db, IAsyncQueryExecutor query, IAccessPolicy policy)
{
    public async Task<IReadOnlyList<KnowledgeBaseMemberDto>> HandleAsync(ListMembersQuery request, CancellationToken ct)
    {
        var kb = await policy.RequireKnowledgeBaseAsync(request.KnowledgeBaseId, KnowledgeBaseRole.Viewer, ct);
        var roles = kb.Members.ToDictionary(m => m.UserId, m => m.Role);
        var ids = roles.Keys.ToList();

        var users = await query.ToListAsync(db.Users.Where(u => ids.Contains(u.Id)), ct);
        return users
            .Select(u => new KnowledgeBaseMemberDto(u.Id, u.DisplayName, u.Email, roles[u.Id]))
            .OrderByDescending(m => m.Role).ThenBy(m => m.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }
}
