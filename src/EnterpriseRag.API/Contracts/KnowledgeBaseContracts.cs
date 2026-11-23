using System.ComponentModel.DataAnnotations;
using EnterpriseRag.Domain.KnowledgeBases;

namespace EnterpriseRag.API.Contracts;

public sealed record CreateKnowledgeBaseRequest(string Name, string? Description);

/// <summary>Body of <c>PUT /api/knowledge-bases/{id}</c>; the row version travels in the required <c>If-Match</c> header.</summary>
public sealed record UpdateKnowledgeBaseRequest(string Name, string? Description);

public sealed record AddMemberRequest(Guid UserId, [Required] KnowledgeBaseRole? Role);

public sealed record ChangeMemberRoleRequest([Required] KnowledgeBaseRole? Role);
