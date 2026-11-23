using EnterpriseRag.Application.Auth;
using EnterpriseRag.Application.Security;
using EnterpriseRag.Application.Tests.Fakes;

namespace EnterpriseRag.Application.Tests.Auth;

public class RefreshHandlerTests
{
    private readonly TestHarness _h = new();

    private async Task<AuthResult> LoginAsync(string email = "erin@example.com")
    {
        if (!_h.Db.Users.Any(u => u.Email == email))
        {
            _h.AddUser(email);
        }

        return await _h.Login().HandleAsync(new LoginCommand(email, TestHarness.DefaultPassword), CancellationToken.None);
    }

    [Fact]
    public async Task Refresh_RotatesToken_AndRevokesOld()
    {
        var login = await LoginAsync();
        var original = Assert.Single(_h.Db.RefreshTokens);

        _h.Clock.Advance(TimeSpan.FromMinutes(5));
        var refreshed = await _h.Refresh().HandleAsync(new RefreshCommand(login.RefreshToken), CancellationToken.None);

        Assert.NotEqual(login.RefreshToken, refreshed.RefreshToken);
        Assert.False(string.IsNullOrEmpty(refreshed.AccessToken));
        Assert.Equal(_h.Clock.UtcNow, original.RevokedAt);
        Assert.Equal(_h.Tokens.HashRefreshToken(refreshed.RefreshToken), original.ReplacedByTokenHash);

        var replacement = _h.Db.RefreshTokens.Single(t => t.TokenHash == original.ReplacedByTokenHash);
        Assert.Equal(original.FamilyId, replacement.FamilyId);
        Assert.True(replacement.IsActive(_h.Clock.UtcNow));
        Assert.Contains(_h.Audit.Entries, e => e.Action == AuditActions.TokenRefreshed);
    }

    [Fact]
    public async Task Refresh_ReusedRotatedToken_RevokesWholeFamily()
    {
        var login = await LoginAsync();
        var otherSession = await LoginAsync();
        var rotated = await _h.Refresh().HandleAsync(new RefreshCommand(login.RefreshToken), CancellationToken.None);

        await Assert.ThrowsAsync<AuthenticationFailedException>(() =>
            _h.Refresh().HandleAsync(new RefreshCommand(login.RefreshToken), CancellationToken.None));

        var familyId = _h.Db.RefreshTokens.Single(t => t.TokenHash == _h.Tokens.HashRefreshToken(login.RefreshToken)).FamilyId;
        Assert.All(_h.Db.RefreshTokens.Where(t => t.FamilyId == familyId), t => Assert.NotNull(t.RevokedAt));
        await Assert.ThrowsAsync<AuthenticationFailedException>(() =>
            _h.Refresh().HandleAsync(new RefreshCommand(rotated.RefreshToken), CancellationToken.None));

        // A different login (different family) is unaffected.
        var other = await _h.Refresh().HandleAsync(new RefreshCommand(otherSession.RefreshToken), CancellationToken.None);
        Assert.False(string.IsNullOrEmpty(other.AccessToken));
        Assert.Contains(_h.Audit.Entries, e => e.Action == AuditActions.RefreshTokenReuseDetected);
    }

    [Theory]
    [InlineData(1)] // rotation save loses the race; the family-revocation save succeeds
    [InlineData(2)] // the family-revocation save conflicts as well
    public async Task Refresh_ConcurrentRotation_ConflictOnSave_RevokesFamilyAndFails(int conflictingSaves)
    {
        var login = await LoginAsync();
        var familyId = Assert.Single(_h.Db.RefreshTokens).FamilyId;
        for (var i = 0; i < conflictingSaves; i++)
        {
            _h.Db.SaveFailures.Enqueue(new ConflictException("Concurrency conflict."));
        }

        var ex = await Assert.ThrowsAsync<AuthenticationFailedException>(() =>
            _h.Refresh().HandleAsync(new RefreshCommand(login.RefreshToken), CancellationToken.None));

        Assert.Equal(AuthenticationFailedException.GenericMessage, ex.Message);
        Assert.All(_h.Db.RefreshTokens.Where(t => t.FamilyId == familyId), t => Assert.NotNull(t.RevokedAt));
        Assert.DoesNotContain(_h.Db.RefreshTokens, t => t.IsActive(_h.Clock.UtcNow));
        var entry = Assert.Single(_h.Audit.Entries, e => e.Action == AuditActions.RefreshTokenReuseDetected);
        Assert.Equal($"{{\"familyId\":\"{familyId}\"}}", entry.DetailsJson);
    }

    [Fact]
    public async Task Refresh_ForInactiveUser_Fails()
    {
        var login = await LoginAsync();
        _h.Db.Users.Single().Deactivate();

        await Assert.ThrowsAsync<AuthenticationFailedException>(() =>
            _h.Refresh().HandleAsync(new RefreshCommand(login.RefreshToken), CancellationToken.None));

        Assert.All(_h.Db.RefreshTokens, t => Assert.NotNull(t.RevokedAt));
    }

    [Fact]
    public async Task Refresh_ExpiredToken_Fails()
    {
        var login = await LoginAsync();
        _h.Clock.Advance(TimeSpan.FromDays(8));

        await Assert.ThrowsAsync<AuthenticationFailedException>(() =>
            _h.Refresh().HandleAsync(new RefreshCommand(login.RefreshToken), CancellationToken.None));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-real-token")]
    public async Task Refresh_UnknownToken_Fails(string raw)
    {
        await LoginAsync();

        var ex = await Assert.ThrowsAsync<AuthenticationFailedException>(() =>
            _h.Refresh().HandleAsync(new RefreshCommand(raw), CancellationToken.None));

        Assert.Equal(AuthenticationFailedException.GenericMessage, ex.Message);
    }

    [Fact]
    public async Task Logout_RevokesWholeFamily()
    {
        var login = await LoginAsync();
        var rotated = await _h.Refresh().HandleAsync(new RefreshCommand(login.RefreshToken), CancellationToken.None);

        await _h.Logout().HandleAsync(new LogoutCommand(rotated.RefreshToken), CancellationToken.None);

        Assert.All(_h.Db.RefreshTokens, t => Assert.NotNull(t.RevokedAt));
        Assert.Contains(_h.Audit.Entries, e => e.Action == AuditActions.Logout);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("unknown")]
    public async Task Logout_UnknownToken_IsSilent(string? raw)
    {
        await _h.Logout().HandleAsync(new LogoutCommand(raw), CancellationToken.None);

        Assert.Equal(0, _h.Db.SaveCount);
    }
}
