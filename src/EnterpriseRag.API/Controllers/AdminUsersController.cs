using EnterpriseRag.API.Auth;
using EnterpriseRag.API.Contracts;
using EnterpriseRag.Application.Common;
using EnterpriseRag.Application.Users;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EnterpriseRag.API.Controllers;

/// <summary>Admin-only user management. The handlers enforce admin again (defense in depth).</summary>
[ApiController]
[Route("api/admin/users")]
[Authorize(Policy = AuthenticationSetup.AdminOnlyPolicy)]
public sealed class AdminUsersController : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<CreatedUserResult>> Create(
        CreateUserRequest request, [FromServices] CreateUserHandler handler, CancellationToken ct)
    {
        var result = await handler.HandleAsync(new CreateUserCommand(request.Email, request.DisplayName, request.GlobalRole), ct);
        NoStore();
        return StatusCode(StatusCodes.Status201Created, result);
    }

    [HttpGet]
    public async Task<ActionResult<PagedResult<UserSummaryDto>>> List(
        [FromServices] ListUsersHandler handler, CancellationToken ct, [FromQuery] int page = 1, [FromQuery] int pageSize = 20) =>
        Ok(await handler.HandleAsync(new ListUsersQuery(page, pageSize), ct));

    [HttpPost("{id:guid}/deactivate")]
    public async Task<IActionResult> Deactivate(Guid id, [FromServices] DeactivateUserHandler handler, CancellationToken ct)
    {
        await handler.HandleAsync(new DeactivateUserCommand(id), ct);
        return NoContent();
    }

    [HttpPost("{id:guid}/reset-password")]
    public async Task<ActionResult<TemporaryPasswordResponse>> ResetPassword(
        Guid id, [FromServices] ResetPasswordHandler handler, CancellationToken ct)
    {
        var result = await handler.HandleAsync(new ResetPasswordCommand(id), ct);
        NoStore();
        return Ok(new TemporaryPasswordResponse(result.TemporaryPassword));
    }

    private void NoStore() => Response.Headers.CacheControl = "no-store";
}
