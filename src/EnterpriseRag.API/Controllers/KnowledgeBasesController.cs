using EnterpriseRag.API.Contracts;
using EnterpriseRag.API.Http;
using EnterpriseRag.Application.Common;
using EnterpriseRag.Application.KnowledgeBases;
using Microsoft.AspNetCore.Mvc;

namespace EnterpriseRag.API.Controllers;

/// <summary>
/// Knowledge bases (authenticated via the fallback policy). Authorization is decided by the handlers through
/// <c>IAccessPolicy</c>: non-members (global Admin included) get 404, members below the required role get 403.
/// </summary>
[ApiController]
[Route("api/knowledge-bases")]
public sealed class KnowledgeBasesController : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<KnowledgeBaseDto>> Create(
        CreateKnowledgeBaseRequest request, [FromServices] CreateKnowledgeBaseHandler handler, CancellationToken ct)
    {
        var dto = await handler.HandleAsync(new CreateKnowledgeBaseCommand(request.Name, request.Description), ct);
        SetETag(dto);
        return CreatedAtAction(nameof(Get), new { id = dto.Id }, dto);
    }

    /// <summary>Only the caller's own knowledge bases (memberships), paged.</summary>
    [HttpGet]
    public async Task<ActionResult<PagedResult<KnowledgeBaseDto>>> List(
        [FromServices] ListKnowledgeBasesHandler handler, CancellationToken ct, [FromQuery] int page = 1, [FromQuery] int pageSize = 20) =>
        Ok(await handler.HandleAsync(new ListKnowledgeBasesQuery(page, pageSize), ct));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<KnowledgeBaseDto>> Get(Guid id, [FromServices] GetKnowledgeBaseHandler handler, CancellationToken ct)
    {
        var dto = await handler.HandleAsync(new GetKnowledgeBaseQuery(id), ct);
        SetETag(dto);
        return Ok(dto);
    }

    /// <summary>Owner only. Requires <c>If-Match</c> with the current ETag: missing → 428, stale → 412.</summary>
    [HttpPut("{id:guid}")]
    public async Task<ActionResult<KnowledgeBaseDto>> Update(
        Guid id, UpdateKnowledgeBaseRequest request, [FromServices] UpdateKnowledgeBaseHandler handler, CancellationToken ct)
    {
        switch (RowVersionETag.TryReadIfMatch(Request, out var rowVersion))
        {
            case RowVersionETag.IfMatchResult.Missing:
                return Problem(
                    statusCode: StatusCodes.Status428PreconditionRequired,
                    title: "Precondition Required",
                    detail: "An If-Match header carrying the knowledge base's ETag is required.");
            case RowVersionETag.IfMatchResult.Invalid:
                return Problem(
                    statusCode: StatusCodes.Status400BadRequest,
                    title: "Bad Request",
                    detail: "The If-Match header must be a single strong ETag previously returned by the API.");
        }

        var dto = await handler.HandleAsync(new UpdateKnowledgeBaseCommand(id, request.Name, request.Description, rowVersion), ct);
        SetETag(dto);
        return Ok(dto);
    }

    /// <summary>Owner only; soft delete.</summary>
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, [FromServices] DeleteKnowledgeBaseHandler handler, CancellationToken ct)
    {
        await handler.HandleAsync(new DeleteKnowledgeBaseCommand(id), ct);
        return NoContent();
    }

    private void SetETag(KnowledgeBaseDto dto) => Response.Headers.ETag = RowVersionETag.Format(dto.RowVersion);
}
