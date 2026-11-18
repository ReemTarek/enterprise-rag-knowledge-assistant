using EnterpriseRag.API.Auth;
using EnterpriseRag.API.Contracts;
using EnterpriseRag.Application.Auth;
using EnterpriseRag.Application.Users;
using Microsoft.AspNetCore.Mvc;

namespace EnterpriseRag.API.Controllers;

/// <summary>The signed-in user's own profile and password. Requires authentication (fallback policy).</summary>
[ApiController]
[Route("api/me")]
public sealed class MeController : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<MeResponse>> Get([FromServices] GetCurrentUserHandler handler, CancellationToken ct) =>
        Ok(MeResponse.From(await handler.HandleAsync(ct)));

    /// <summary>
    /// Changes the password and ends every other session. The refresh cookie, when the browser sends it, identifies
    /// the current session to keep (see <see cref="ChangePasswordCommand.CurrentRefreshTokenRaw"/>).
    /// </summary>
    [HttpPost("password")]
    public async Task<IActionResult> ChangePassword(
        ChangePasswordRequest request, [FromServices] ChangePasswordHandler handler, CancellationToken ct)
    {
        await handler.HandleAsync(
            new ChangePasswordCommand(request.CurrentPassword, request.NewPassword, RefreshCookie.Read(Request)), ct);
        return NoContent();
    }
}
