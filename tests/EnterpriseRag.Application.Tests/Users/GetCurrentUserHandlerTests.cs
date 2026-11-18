using EnterpriseRag.Application.Security;
using EnterpriseRag.Application.Tests.Fakes;
using EnterpriseRag.Application.Users;
using EnterpriseRag.Domain.Identity;

namespace EnterpriseRag.Application.Tests.Users;

public class GetCurrentUserHandlerTests
{
    private readonly TestHarness _h = new();

    [Fact]
    public async Task GetCurrentUser_ReturnsOwnProfile()
    {
        var user = _h.AddUser("frank@example.com", "Frank", role: GlobalRole.Admin, mustChange: true);
        _h.AddUser("gina@example.com", "Gina");
        _h.SignInAs(user);

        var me = await _h.GetCurrentUser().HandleAsync(CancellationToken.None);

        Assert.Equal(new CurrentUserDto(user.Id, "frank@example.com", "Frank", GlobalRole.Admin, true), me);
    }

    [Fact]
    public async Task GetCurrentUser_Anonymous_IsDenied() =>
        await Assert.ThrowsAsync<AccessDeniedException>(() => _h.GetCurrentUser().HandleAsync(CancellationToken.None));

    [Fact]
    public async Task GetCurrentUser_Inactive_IsNotFound()
    {
        var user = _h.AddUser("frank@example.com", active: false);
        _h.SignInAs(user);

        await Assert.ThrowsAsync<NotFoundException>(() => _h.GetCurrentUser().HandleAsync(CancellationToken.None));
    }
}
