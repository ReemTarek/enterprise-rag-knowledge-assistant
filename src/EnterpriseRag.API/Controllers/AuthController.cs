using EnterpriseRag.API.Auth;
using EnterpriseRag.API.Contracts;
using EnterpriseRag.API.Http;
using EnterpriseRag.Application.Auth;
using EnterpriseRag.Application.Security;
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
        NoStore();
        return Ok(AccessTokenResponse.From(result));
    }

    /// <summary>
    /// Reads the refresh token from the cookie only; a token in the body is ignored. A failed refresh deletes the
    /// (dead) cookie and answers the same generic 401 as every other credential failure. It is written here rather
    /// than thrown because the exception middleware clears response headers, which would drop the deletion.
    /// </summary>
    [AllowAnonymous]
    [EnableRateLimiting(AuthenticationSetup.RefreshRateLimitPolicy)]
    [HttpPost("refresh")]
    public async Task<ActionResult<AccessTokenResponse>> Refresh([FromServices] RefreshHandler handler, CancellationToken ct)
    {
        var presented = RefreshCookie.Read(Request);
        AuthResult result;
        try
        {
            result = await handler.HandleAsync(new RefreshCommand(presented ?? string.Empty), ct);
        }
        catch (AuthenticationFailedException)
        {
            if (presented is not null)
            {
                RefreshCookie.Delete(Response); // only a cookie the browser actually sent is dead
            }

            return Problem(
                statusCode: StatusCodes.Status401Unauthorized,
                title: "Unauthorized",
                detail: AuthenticationFailedException.GenericMessage,
                type: ProblemTypes.Unauthorized);
        }

        RefreshCookie.Append(Response, result.RefreshToken, result.RefreshTokenExpiresAtUtc);
        NoStore();
        return Ok(AccessTokenResponse.From(result));
    }

    /// <summary>
    /// Anonymous: the refresh cookie is the credential, so a client with an expired access token can still sign out.
    /// Unknown or missing cookies succeed silently; the cookie is always cleared.
    /// </summary>
    [AllowAnonymous]
    [EnableRateLimiting(AuthenticationSetup.RefreshRateLimitPolicy)]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout([FromServices] LogoutHandler handler, CancellationToken ct)
    {
        await handler.HandleAsync(new LogoutCommand(RefreshCookie.Read(Request)), ct);
        RefreshCookie.Delete(Response);
        return NoContent();
    }

    /// <summary>
    /// Changes the caller's password (access token required) and ends every other session. It lives under
    /// <c>/api/auth</c> so the browser sends the refresh cookie (Path=/api/auth), which identifies the session to keep.
    /// </summary>
    [AllowWhilePasswordChangeRequired]
    [EnableRateLimiting(AuthenticationSetup.LoginRateLimitPolicy)] // current-password oracle: shares the login bucket
    [HttpPost("password")]
    public async Task<IActionResult> ChangePassword(
        ChangePasswordRequest request, [FromServices] ChangePasswordHandler handler, CancellationToken ct)
    {
        await handler.HandleAsync(
            new ChangePasswordCommand(request.CurrentPassword, request.NewPassword, RefreshCookie.Read(Request)), ct);
        return NoContent();
    }

    /// <summary>Token-bearing responses must never be stored by browsers or intermediaries.</summary>
    private void NoStore()
    {
        Response.Headers.CacheControl = "no-store";
        Response.Headers.Pragma = "no-cache";
    }
}
