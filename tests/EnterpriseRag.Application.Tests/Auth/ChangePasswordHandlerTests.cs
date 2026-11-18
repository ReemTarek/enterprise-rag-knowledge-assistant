using EnterpriseRag.Application.Auth;
using EnterpriseRag.Application.Tests.Fakes;
using FluentValidation;

namespace EnterpriseRag.Application.Tests.Auth;

public class ChangePasswordHandlerTests
{
    private readonly TestHarness _h = new();

    [Theory]
    [InlineData("Short-1a")]            // too short
    [InlineData("alllowercase-123")]    // no upper
    [InlineData("ALLUPPERCASE-123")]    // no lower
    [InlineData("NoDigitsAtAll-xx")]    // no digit
    public async Task ChangePassword_WeakNewPassword_FailsValidation(string newPassword)
    {
        _h.SignInAs(_h.AddUser("frank@example.com", mustChange: true));

        await Assert.ThrowsAsync<ValidationException>(() =>
            _h.ChangePassword().HandleAsync(new ChangePasswordCommand(TestHarness.DefaultPassword, newPassword), CancellationToken.None));
    }

    [Fact]
    public async Task ChangePassword_WrongCurrentPassword_Fails()
    {
        var user = _h.AddUser("frank@example.com", mustChange: true);
        _h.SignInAs(user);

        await Assert.ThrowsAsync<ValidationException>(() =>
            _h.ChangePassword().HandleAsync(new ChangePasswordCommand("Not-The-Password-1", "Brand-New-Pass-99"), CancellationToken.None));

        Assert.True(user.MustChangePassword);
    }

    [Fact]
    public async Task ChangePassword_Valid_UpdatesHash_ClearsMustChange_AndAudits()
    {
        var user = _h.AddUser("frank@example.com", mustChange: true);
        _h.SignInAs(user);

        await _h.ChangePassword().HandleAsync(new ChangePasswordCommand(TestHarness.DefaultPassword, "Brand-New-Pass-99"), CancellationToken.None);

        Assert.False(user.MustChangePassword);
        Assert.True(_h.Hasher.Verify(user.PasswordHash, "Brand-New-Pass-99"));
        var entry = Assert.Single(_h.Audit.Entries);
        Assert.Equal(AuditActions.PasswordChanged, entry.Action);
        Assert.DoesNotContain("Brand-New-Pass-99", entry.DetailsJson ?? string.Empty);
    }
}
