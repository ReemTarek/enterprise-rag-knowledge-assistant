using EnterpriseRag.Application.Auth;
using EnterpriseRag.Application.Security;
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

    [Fact]
    public async Task ChangePassword_WithCurrentRefreshToken_RevokesOtherSessions_KeepsCurrentFamily()
    {
        var user = _h.AddUser("frank@example.com");
        var current = await LoginAsync("frank@example.com");
        var other = await LoginAsync("frank@example.com");
        var otherUser = _h.AddUser("gina@example.com");
        await LoginAsync("gina@example.com");
        _h.SignInAs(user);

        await _h.ChangePassword().HandleAsync(
            new ChangePasswordCommand(TestHarness.DefaultPassword, "Brand-New-Pass-99", current.RefreshToken), CancellationToken.None);

        var currentFamily = FamilyOf(current.RefreshToken);
        Assert.All(_h.Db.RefreshTokens.Where(t => t.UserId == user.Id && t.FamilyId != currentFamily), t => Assert.NotNull(t.RevokedAt));
        Assert.All(_h.Db.RefreshTokens.Where(t => t.FamilyId == currentFamily), t => Assert.Null(t.RevokedAt));
        Assert.All(_h.Db.RefreshTokens.Where(t => t.UserId == otherUser.Id), t => Assert.Null(t.RevokedAt));

        // The current device can keep refreshing; the other session cannot.
        await _h.Refresh().HandleAsync(new RefreshCommand(current.RefreshToken), CancellationToken.None);
        await Assert.ThrowsAsync<AuthenticationFailedException>(() =>
            _h.Refresh().HandleAsync(new RefreshCommand(other.RefreshToken), CancellationToken.None));
    }

    [Fact]
    public async Task ChangePassword_WithoutCurrentRefreshToken_RevokesAllSessions()
    {
        var user = _h.AddUser("frank@example.com");
        await LoginAsync("frank@example.com");
        await LoginAsync("frank@example.com");
        _h.SignInAs(user);

        await _h.ChangePassword().HandleAsync(
            new ChangePasswordCommand(TestHarness.DefaultPassword, "Brand-New-Pass-99"), CancellationToken.None);

        Assert.All(_h.Db.RefreshTokens, t => Assert.NotNull(t.RevokedAt));
    }

    [Fact]
    public async Task ChangePassword_WithAnotherUsersRefreshToken_KeepsNothing()
    {
        var user = _h.AddUser("frank@example.com");
        await LoginAsync("frank@example.com");
        _h.AddUser("gina@example.com");
        var foreign = await LoginAsync("gina@example.com");
        _h.SignInAs(user);

        await _h.ChangePassword().HandleAsync(
            new ChangePasswordCommand(TestHarness.DefaultPassword, "Brand-New-Pass-99", foreign.RefreshToken), CancellationToken.None);

        Assert.All(_h.Db.RefreshTokens.Where(t => t.UserId == user.Id), t => Assert.NotNull(t.RevokedAt));
        Assert.All(_h.Db.RefreshTokens.Where(t => t.UserId != user.Id), t => Assert.Null(t.RevokedAt));
    }

    [Fact]
    public async Task ChangePassword_Failure_RevokesNothing()
    {
        var user = _h.AddUser("frank@example.com");
        await LoginAsync("frank@example.com");
        _h.SignInAs(user);

        await Assert.ThrowsAsync<ValidationException>(() =>
            _h.ChangePassword().HandleAsync(new ChangePasswordCommand("Not-The-Password-1", "Brand-New-Pass-99"), CancellationToken.None));

        Assert.All(_h.Db.RefreshTokens, t => Assert.Null(t.RevokedAt));
    }

    private Task<AuthResult> LoginAsync(string email) =>
        _h.Login().HandleAsync(new LoginCommand(email, TestHarness.DefaultPassword), CancellationToken.None);

    private Guid FamilyOf(string rawRefreshToken) =>
        _h.Db.RefreshTokens.Single(t => t.TokenHash == _h.Tokens.HashRefreshToken(rawRefreshToken)).FamilyId;
}
