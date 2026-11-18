using EnterpriseRag.API.Auth;
using EnterpriseRag.API.Contracts;
using EnterpriseRag.Application.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace EnterpriseRag.API.Controllers;

/// <summary>Token endpoints. Failures surface as exceptions mapped by <c>GlobalExceptionHandler</c> (generic 401).</summary>
[ApiController]
[Route("api/auth")]
public sealed class AuthController : ControllerBase
{
    [AllowAnonymous]
    [EnableRateLimiting(AuthenticationSetup.LoginRateLimitPolicy)]
    [HttpPost("login")]
    public async Task<ActionResult<AccessTokenResponse>> Login(
        LoginRequest request, [FromServices] LoginHandler handler, CancellationToken ct)
    {
        var result = await handler.HandleAsync(new LoginCommand(request.Email, request.Password), ct);
        RefreshCookie.Append(Response, result.RefreshToken, result.RefreshTokenExpiresAtUtc);
        return Ok(AccessTokenResponse.From(result));
    }

    /// <summary>Reads the refresh token from the cookie only; a token in the body is ignored.</summary>
    [AllowAnonymous]
    [EnableRateLimiting(AuthenticationSetup.RefreshRateLimitPolicy)]
    [HttpPost("refresh")]
    public async Task<ActionResult<AccessTokenResponse>> Refresh([FromServices] RefreshHandler handler, CancellationToken ct)
    {
        var result = await handler.HandleAsync(new RefreshCommand(RefreshCookie.Read(Request) ?? string.Empty), ct);
        RefreshCookie.Append(Response, result.RefreshToken, result.RefreshTokenExpiresAtUtc);
        return Ok(AccessTokenResponse.From(result));
    }

    [HttpPost("logout")]
    public async Task<IActionResult> Logout([FromServices] LogoutHandler handler, CancellationToken ct)
    {
        await handler.HandleAsync(new LogoutCommand(RefreshCookie.Read(Request)), ct);
        RefreshCookie.Delete(Response);
        return NoContent();
    }
}
