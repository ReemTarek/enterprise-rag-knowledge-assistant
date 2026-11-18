using System.Security.Claims;
using EnterpriseRag.Application.Abstractions;

namespace EnterpriseRag.API.Services;

public sealed class HttpCurrentUserService(IHttpContextAccessor accessor) : ICurrentUserService
{
    private ClaimsPrincipal? Principal => accessor.HttpContext?.User;

    public string? UserId =>
        Principal?.FindFirstValue(ClaimTypes.NameIdentifier) ?? Principal?.FindFirstValue("sub");

    public Guid? UserGuid => Guid.TryParse(UserId, out var id) ? id : null;

    public bool IsAdmin =>
        Principal?.HasClaim(c => (c.Type == "role" || c.Type == ClaimTypes.Role) && c.Value == "Admin") ?? false;
}
