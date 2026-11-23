using EnterpriseRag.Application.Users;
using Microsoft.AspNetCore.Mvc;

namespace EnterpriseRag.API.Controllers;

/// <summary>Name/email lookup for any authenticated user (fallback policy), e.g. to pick members to share with.</summary>
[ApiController]
[Route("api/users/directory")]
public sealed class UserDirectoryController : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<DirectoryUserDto>>> Search(
        [FromServices] SearchUserDirectoryHandler handler, CancellationToken ct, [FromQuery] string? query = null) =>
        Ok(await handler.HandleAsync(new SearchUserDirectoryQuery(query ?? string.Empty), ct));
}
