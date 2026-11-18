using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Application.Common;
using EnterpriseRag.Application.Security;
using EnterpriseRag.Domain.KnowledgeBases;
using FluentValidation;

namespace EnterpriseRag.Application.KnowledgeBases;

public sealed record CreateKnowledgeBaseCommand(string Name, string? Description);

public sealed record ListKnowledgeBasesQuery(int Page, int PageSize);

public sealed record GetKnowledgeBaseQuery(Guid KnowledgeBaseId);

/// <param name="RowVersion">Base64 row version the client last saw; when supplied a mismatch raises <see cref="ConflictException"/>.</param>
public sealed record UpdateKnowledgeBaseCommand(Guid KnowledgeBaseId, string Name, string? Description, string? RowVersion);

public sealed record DeleteKnowledgeBaseCommand(Guid KnowledgeBaseId);

internal static class KnowledgeBaseRules
{
    public const int MaxDescriptionLength = 2000;

    public static void NameRules<T>(IRuleBuilder<T, string> rule) =>
        rule.Must(n => !string.IsNullOrWhiteSpace(n) && n.Trim().Length <= KnowledgeBase.MaxNameLength)
            .WithMessage($"Name must be between 1 and {KnowledgeBase.MaxNameLength} characters.");

    public static bool IsBase64(string? value)
    {
        if (value is null)
        {
            return true;
        }

        Span<byte> buffer = stackalloc byte[64];
        return value.Length > 0 && Convert.TryFromBase64String(value, buffer, out _);
    }
}

public sealed class CreateKnowledgeBaseValidator : AbstractValidator<CreateKnowledgeBaseCommand>
{
    public CreateKnowledgeBaseValidator()
    {
        KnowledgeBaseRules.NameRules(RuleFor(c => c.Name));
        RuleFor(c => c.Description).MaximumLength(KnowledgeBaseRules.MaxDescriptionLength);
    }
}

public sealed class UpdateKnowledgeBaseValidator : AbstractValidator<UpdateKnowledgeBaseCommand>
{
    public UpdateKnowledgeBaseValidator()
    {
        KnowledgeBaseRules.NameRules(RuleFor(c => c.Name));
        RuleFor(c => c.Description).MaximumLength(KnowledgeBaseRules.MaxDescriptionLength);
        RuleFor(c => c.RowVersion).Must(KnowledgeBaseRules.IsBase64).WithMessage("RowVersion must be a base64 string.");
    }
}

public sealed class CreateKnowledgeBaseHandler(IAppDbContext db, ICurrentUserService currentUser, IAuditLogger audit)
{
    private static readonly CreateKnowledgeBaseValidator Validator = new();

    public async Task<KnowledgeBaseDto> HandleAsync(CreateKnowledgeBaseCommand command, CancellationToken ct)
    {
        var userId = currentUser.RequireUserId();
        await Validator.ValidateAndThrowAsync(command, ct);

        var kb = KnowledgeBase.Create(command.Name, command.Description, userId);
        db.Add(kb);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(AuditActions.KnowledgeBaseCreated, AuditTargets.KnowledgeBase, kb.Id.ToString(), new { name = kb.Name }, ct);
        return KnowledgeBaseDto.From(kb, userId);
    }
}

/// <summary>Lists only the knowledge bases the caller is a member of (global Admin included), ordered by name.</summary>
public sealed class ListKnowledgeBasesHandler(IAppDbContext db, IAsyncQueryExecutor query, ICurrentUserService currentUser)
{
    public async Task<PagedResult<KnowledgeBaseDto>> HandleAsync(ListKnowledgeBasesQuery request, CancellationToken ct)
    {
        var userId = currentUser.RequireUserId();
        var (page, pageSize, skip) = Paging.Normalize(request.Page, request.PageSize);

        var mine = db.KnowledgeBases.Where(k => !k.IsDeleted && k.Members.Any(m => m.UserId == userId));
        var total = await query.CountAsync(mine, ct);
        var items = await query.ToListAsync(mine.OrderBy(k => k.Name).ThenBy(k => k.Id).Skip(skip).Take(pageSize), ct);

        return new PagedResult<KnowledgeBaseDto>(items.Select(k => KnowledgeBaseDto.From(k, userId)).ToList(), page, pageSize, total);
    }
}

public sealed class GetKnowledgeBaseHandler(IAccessPolicy policy, ICurrentUserService currentUser)
{
    public async Task<KnowledgeBaseDto> HandleAsync(GetKnowledgeBaseQuery request, CancellationToken ct)
    {
        var kb = await policy.RequireKnowledgeBaseAsync(request.KnowledgeBaseId, KnowledgeBaseRole.Viewer, ct);
        return KnowledgeBaseDto.From(kb, currentUser.RequireUserId());
    }
}

public sealed class UpdateKnowledgeBaseHandler(IAppDbContext db, IAccessPolicy policy, ICurrentUserService currentUser, IAuditLogger audit)
{
    private static readonly UpdateKnowledgeBaseValidator Validator = new();

    public async Task<KnowledgeBaseDto> HandleAsync(UpdateKnowledgeBaseCommand command, CancellationToken ct)
    {
        await Validator.ValidateAndThrowAsync(command, ct);
        var kb = await policy.RequireKnowledgeBaseAsync(command.KnowledgeBaseId, KnowledgeBaseRole.Owner, ct);

        if (command.RowVersion is not null)
        {
            db.SetExpectedRowVersion(kb, Convert.FromBase64String(command.RowVersion));
        }

        kb.Rename(command.Name, command.Description);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(AuditActions.KnowledgeBaseUpdated, AuditTargets.KnowledgeBase, kb.Id.ToString(), new { name = kb.Name }, ct);
        return KnowledgeBaseDto.From(kb, currentUser.RequireUserId());
    }
}

/// <summary>Soft-deletes the knowledge base (Owner only); it immediately becomes invisible to everyone.</summary>
public sealed class DeleteKnowledgeBaseHandler(IAppDbContext db, IAccessPolicy policy, IDateTimeProvider clock, IAuditLogger audit)
{
    public async Task HandleAsync(DeleteKnowledgeBaseCommand command, CancellationToken ct)
    {
        var kb = await policy.RequireKnowledgeBaseAsync(command.KnowledgeBaseId, KnowledgeBaseRole.Owner, ct);
        kb.MarkDeleted(clock.UtcNow);
        await db.SaveChangesAsync(ct);
        await audit.LogAsync(AuditActions.KnowledgeBaseDeleted, AuditTargets.KnowledgeBase, kb.Id.ToString(), null, ct);
    }
}
