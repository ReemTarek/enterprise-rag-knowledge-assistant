using EnterpriseRag.Domain.KnowledgeBases;

namespace EnterpriseRag.Application.KnowledgeBases;

/// <summary>Knowledge base as seen by the caller. <see cref="RowVersion"/> is base64 and is echoed back for updates (If-Match).</summary>
public sealed record KnowledgeBaseDto(
    Guid Id,
    string Name,
    string? Description,
    KnowledgeBaseRole MyRole,
    DateTime CreatedAt,
    DateTime? UpdatedAt,
    string RowVersion)
{
    internal static KnowledgeBaseDto From(KnowledgeBase kb, Guid callerId) =>
        new(kb.Id, kb.Name, kb.Description,
            kb.RoleOf(callerId) ?? throw new InvalidOperationException("Caller is not a member."),
            kb.CreatedAt, kb.UpdatedAt, Convert.ToBase64String(kb.RowVersion));
}

public sealed record KnowledgeBaseMemberDto(Guid UserId, string DisplayName, string Email, KnowledgeBaseRole Role);
