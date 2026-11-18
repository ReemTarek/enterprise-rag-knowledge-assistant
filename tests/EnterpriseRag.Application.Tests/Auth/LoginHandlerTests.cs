using EnterpriseRag.Application.Auth;
using EnterpriseRag.Application.Security;
using EnterpriseRag.Application.Tests.Fakes;

namespace EnterpriseRag.Application.Tests.Auth;

public class LoginHandlerTests
{
    private readonly TestHarness _h = new();

    [Fact]
    public async Task Login_WrongPassword_And_UnknownEmail_ReturnSameFailure()
    {
        _h.AddUser("alice@example.com");

        var wrongPassword = await Assert.ThrowsAsync<AuthenticationFailedException>(() =>
            _h.Login().HandleAsync(new LoginCommand("alice@example.com", "Wrong-Password-1"), CancellationToken.None));
        var unknownEmail = await Assert.ThrowsAsync<AuthenticationFailedException>(() =>
            _h.Login().HandleAsync(new LoginCommand("nobody@example.com", "Wrong-Password-1"), CancellationToken.None));

        Assert.Equal(wrongPassword.Message, unknownEmail.Message);
        Assert.Equal(wrongPassword.GetType(), unknownEmail.GetType());
        // The unknown-email path still performs a hash verification (dummy hash) to equalize timing.
        Assert.Equal(2, _h.Hasher.VerifyCount);
    }

    [Fact]
    public async Task Login_LockedOutUser_Fails_EvenWithCorrectPassword()
    {
        var user = _h.AddUser("bob@example.com");
        for (var i = 0; i < _h.Security.MaxFailedLogins; i++)
        {
            await Assert.ThrowsAsync<AuthenticationFailedException>(() =>
                _h.Login().HandleAsync(new LoginCommand("bob@example.com", "bad"), CancellationToken.None));
        }

        var lockoutEnd = user.LockoutEndUtc;
        Assert.Equal(_h.Clock.UtcNow.AddMinutes(15), lockoutEnd);

        _h.Clock.Advance(TimeSpan.FromMinutes(1));
        var locked = await Assert.ThrowsAsync<AuthenticationFailedException>(() =>
            _h.Login().HandleAsync(new LoginCommand("bob@example.com", TestHarness.DefaultPassword), CancellationToken.None));
        Assert.Equal(AuthenticationFailedException.GenericMessage, locked.Message);

        // A wrong attempt while locked must not extend the lockout or count as a failure.
        await Assert.ThrowsAsync<AuthenticationFailedException>(() =>
            _h.Login().HandleAsync(new LoginCommand("bob@example.com", "bad"), CancellationToken.None));
        Assert.Equal(lockoutEnd, user.LockoutEndUtc);
        Assert.Equal(0, user.FailedLoginCount);

        _h.Clock.Advance(TimeSpan.FromMinutes(15));
        var result = await _h.Login().HandleAsync(new LoginCommand("bob@example.com", TestHarness.DefaultPassword), CancellationToken.None);
        Assert.False(string.IsNullOrEmpty(result.AccessToken));
    }

    [Fact]
    public async Task Login_InactiveUser_Fails()
    {
        _h.AddUser("carol@example.com", active: false);

        var ex = await Assert.ThrowsAsync<AuthenticationFailedException>(() =>
            _h.Login().HandleAsync(new LoginCommand("carol@example.com", TestHarness.DefaultPassword), CancellationToken.None));

        Assert.Equal(AuthenticationFailedException.GenericMessage, ex.Message);
        Assert.Empty(_h.Db.RefreshTokens);
    }

    [Fact]
    public async Task Login_Valid_ReturnsTokens_StoresOnlyRefreshHash_AndResetsCounter()
    {
        var user = _h.AddUser("dave@example.com", mustChange: true);
        await Assert.ThrowsAsync<AuthenticationFailedException>(() =>
            _h.Login().HandleAsync(new LoginCommand("dave@example.com", "bad"), CancellationToken.None));
        Assert.Equal(1, user.FailedLoginCount);
        Assert.Equal(1, _h.Db.SaveCount); // failed attempt is persisted

        var result = await _h.Login().HandleAsync(new LoginCommand("  Dave@Example.com ", TestHarness.DefaultPassword), CancellationToken.None);

        Assert.True(result.MustChangePassword);
        Assert.Equal(0, user.FailedLoginCount);
        Assert.Equal(2, _h.Db.SaveCount); // counter reset and refresh token are persisted
        var stored = Assert.Single(_h.Db.RefreshTokens);
        Assert.Equal(_h.Tokens.HashRefreshToken(result.RefreshToken), stored.TokenHash);
        Assert.NotEqual(result.RefreshToken, stored.TokenHash);
        Assert.Equal(user.Id, stored.UserId);
        Assert.Equal(result.RefreshTokenExpiresAtUtc, stored.ExpiresAt);
        Assert.Contains(_h.Audit.Entries, e => e.Action == AuditActions.LoginSucceeded && e.TargetId == user.Id.ToString());
        Assert.DoesNotContain(_h.Audit.Entries, e => e.DetailsJson?.Contains(TestHarness.DefaultPassword) == true);
    }
}
