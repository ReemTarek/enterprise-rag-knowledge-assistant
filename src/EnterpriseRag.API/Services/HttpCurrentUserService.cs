using System.Security.Claims;
using EnterpriseRag.Application.Abstractions;

namespace EnterpriseRag.API.Services;

public sealed class HttpCurrentUserService(IHttpContextAccessor accessor) : ICurrentUserService
{
    public string? UserId => accessor.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier);
}
