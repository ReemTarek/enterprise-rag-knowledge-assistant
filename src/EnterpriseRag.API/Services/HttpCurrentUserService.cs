using System.Security.Claims;
using EnterpriseRag.Application.Abstractions;

namespace EnterpriseRag.API.Services;

/// <summary>
/// Reads the caller from the validated access token. JwtBearer runs with <c>MapInboundClaims = false</c>, so the claims
/// keep their JWT names (<c>sub</c>, <c>role</c>); the mapped CLR names are a fallback only.
/// </summary>
public sealed class HttpCurrentUserService(IHttpContextAccessor accessor) : ICurrentUserService
{
    private ClaimsPrincipal? Principal => accessor.HttpContext?.User;

    public string? UserId =>
        Principal?.FindFirstValue("sub") ?? Principal?.FindFirstValue(ClaimTypes.NameIdentifier);

    public Guid? UserGuid => Guid.TryParse(UserId, out var id) ? id : null;

    public bool IsAdmin =>
        Principal?.HasClaim(c => (c.Type == "role" || c.Type == ClaimTypes.Role) && c.Value == "Admin") ?? false;
}
