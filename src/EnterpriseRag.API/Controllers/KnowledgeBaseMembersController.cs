using EnterpriseRag.API.Contracts;
using EnterpriseRag.Application.KnowledgeBases;
using Microsoft.AspNetCore.Mvc;

namespace EnterpriseRag.API.Controllers;

/// <summary>
/// Knowledge-base membership. Listing needs any membership; changes need Owner. The handlers check the caller's role
/// on the KB in the route first, then that the target user id is a member of THAT knowledge base.
/// </summary>
[ApiController]
[Route("api/knowledge-bases/{knowledgeBaseId:guid}/members")]
public sealed class KnowledgeBaseMembersController : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<KnowledgeBaseMemberDto>>> List(
        Guid knowledgeBaseId, [FromServices] ListMembersHandler handler, CancellationToken ct) =>
        Ok(await handler.HandleAsync(new ListMembersQuery(knowledgeBaseId), ct));

    [HttpPost]
    public async Task<ActionResult<KnowledgeBaseMemberDto>> Add(
        Guid knowledgeBaseId, AddMemberRequest request, [FromServices] AddMemberHandler handler, CancellationToken ct)
    {
        var dto = await handler.HandleAsync(new AddMemberCommand(knowledgeBaseId, request.UserId, request.Role!.Value), ct);
        return StatusCode(StatusCodes.Status201Created, dto);
    }

    [HttpPut("{userId:guid}")]
    public async Task<ActionResult<KnowledgeBaseMemberDto>> ChangeRole(
        Guid knowledgeBaseId, Guid userId, ChangeMemberRoleRequest request, [FromServices] ChangeMemberRoleHandler handler, CancellationToken ct) =>
        Ok(await handler.HandleAsync(new ChangeMemberRoleCommand(knowledgeBaseId, userId, request.Role!.Value), ct));

    [HttpDelete("{userId:guid}")]
    public async Task<IActionResult> Remove(
        Guid knowledgeBaseId, Guid userId, [FromServices] RemoveMemberHandler handler, CancellationToken ct)
    {
        await handler.HandleAsync(new RemoveMemberCommand(knowledgeBaseId, userId), ct);
        return NoContent();
    }
}
