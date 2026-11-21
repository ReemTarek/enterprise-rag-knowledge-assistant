using EnterpriseRag.API.Auth;
using EnterpriseRag.API.Contracts;
using EnterpriseRag.Application.Users;
using Microsoft.AspNetCore.Mvc;

namespace EnterpriseRag.API.Controllers;

/// <summary>The signed-in user's own profile. Requires authentication (fallback policy).</summary>
/// <remarks>Password change is <c>POST /api/auth/password</c> (it needs the /api/auth-scoped refresh cookie).</remarks>
[ApiController]
[Route("api/me")]
public sealed class MeController : ControllerBase
{
    /// <summary>Allowed while a password change is pending, so the client can learn why other calls get 403.</summary>
    [AllowWhilePasswordChangeRequired]
    [HttpGet]
    public async Task<ActionResult<MeResponse>> Get([FromServices] GetCurrentUserHandler handler, CancellationToken ct) =>
        Ok(MeResponse.From(await handler.HandleAsync(ct)));
}
