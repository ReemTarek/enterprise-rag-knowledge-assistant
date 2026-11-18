using EnterpriseRag.Application.Auth;
using EnterpriseRag.Application.Security;
using EnterpriseRag.Application.Tests.Fakes;
using EnterpriseRag.Application.Users;
using EnterpriseRag.Domain.Identity;
using FluentValidation;

namespace EnterpriseRag.Application.Tests.Users;

public class UserHandlerTests
{
    private readonly TestHarness _h = new();

    private User SignInAdmin()
    {
        var admin = _h.AddUser("admin@example.com", "Admin", role: GlobalRole.Admin);
        _h.SignInAs(admin);
        return admin;
    }

    [Fact]
    public async Task CreateUser_ByNonAdmin_IsDenied()
    {
        _h.SignInAs(_h.AddUser("user@example.com"));

        await Assert.ThrowsAsync<AccessDeniedException>(() =>
            _h.CreateUser().HandleAsync(new CreateUserCommand("new@example.com", "New User", GlobalRole.User), CancellationToken.None));

        Assert.Single(_h.Db.Users);
        Assert.Empty(_h.Audit.Entries);
    }

    [Fact]
    public async Task CreateUser_DuplicateEmail_Fails()
    {
        SignInAdmin();
        _h.AddUser("taken@example.com");

        await Assert.ThrowsAsync<ConflictException>(() =>
            _h.CreateUser().HandleAsync(new CreateUserCommand(" TAKEN@example.com", "Dup", GlobalRole.User), CancellationToken.None));
    }

    [Fact]
    public async Task CreateUser_ReturnsTemporaryPassword_AndSetsMustChange()
    {
        SignInAdmin();

        var result = await _h.CreateUser().HandleAsync(new CreateUserCommand("New@Example.com", "New User", GlobalRole.User), CancellationToken.None);

        Assert.Equal("new@example.com", result.Email);
        Assert.False(string.IsNullOrWhiteSpace(result.TemporaryPassword));
        var created = _h.Db.Users.Single(u => u.Id == result.Id);
        Assert.True(created.MustChangePassword);
        Assert.True(created.IsActive);
        Assert.NotEqual(result.TemporaryPassword, created.PasswordHash);
        Assert.True(_h.Hasher.Verify(created.PasswordHash, result.TemporaryPassword));

        var entry = Assert.Single(_h.Audit.Entries);
        Assert.Equal(AuditActions.UserCreated, entry.Action);
        Assert.DoesNotContain(result.TemporaryPassword, entry.DetailsJson ?? string.Empty);
        Assert.DoesNotContain(created.PasswordHash, entry.DetailsJson ?? string.Empty);

        // The temporary password works for login and forces a change.
        var login = await _h.Login().HandleAsync(new LoginCommand("new@example.com", result.TemporaryPassword), CancellationToken.None);
        Assert.True(login.MustChangePassword);
    }

    [Theory]
    [InlineData("not-an-email", "Name")]
    [InlineData("ok@example.com", "")]
    public async Task CreateUser_InvalidInput_FailsValidation(string email, string displayName)
    {
        SignInAdmin();

        await Assert.ThrowsAsync<ValidationException>(() =>
            _h.CreateUser().HandleAsync(new CreateUserCommand(email, displayName, GlobalRole.User), CancellationToken.None));
    }

    [Fact]
    public async Task ListUsers_ByNonAdmin_IsDenied()
    {
        _h.SignInAs(_h.AddUser("user@example.com"));

        await Assert.ThrowsAsync<AccessDeniedException>(() =>
            _h.ListUsers().HandleAsync(new ListUsersQuery(1, 20), CancellationToken.None));
    }

    [Fact]
    public async Task ListUsers_PagesAndCapsPageSize()
    {
        SignInAdmin();
        for (var i = 0; i < 120; i++)
        {
            _h.AddUser($"user{i:D3}@example.com");
        }

        var result = await _h.ListUsers().HandleAsync(new ListUsersQuery(1, 500), CancellationToken.None);

        Assert.Equal(100, result.PageSize);
        Assert.Equal(100, result.Items.Count);
        Assert.Equal(121, result.TotalCount);
        var page2 = await _h.ListUsers().HandleAsync(new ListUsersQuery(2, 100), CancellationToken.None);
        Assert.Equal(21, page2.Items.Count);
    }

    [Fact]
    public async Task DeactivateUser_DeactivatesAndRevokesRefreshTokens()
    {
        var target = _h.AddUser("target@example.com");
        var login = await _h.Login().HandleAsync(new LoginCommand("target@example.com", TestHarness.DefaultPassword), CancellationToken.None);
        SignInAdmin();

        await _h.DeactivateUser().HandleAsync(new DeactivateUserCommand(target.Id), CancellationToken.None);

        Assert.False(target.IsActive);
        Assert.All(_h.Db.RefreshTokens, t => Assert.NotNull(t.RevokedAt));
        Assert.Contains(_h.Audit.Entries, e => e.Action == AuditActions.UserDeactivated && e.TargetId == target.Id.ToString());
        await Assert.ThrowsAsync<AuthenticationFailedException>(() =>
            _h.Refresh().HandleAsync(new RefreshCommand(login.RefreshToken), CancellationToken.None));
    }

    [Fact]
    public async Task DeactivateUser_Self_IsConflict()
    {
        var admin = SignInAdmin();

        await Assert.ThrowsAsync<ConflictException>(() =>
            _h.DeactivateUser().HandleAsync(new DeactivateUserCommand(admin.Id), CancellationToken.None));
    }

    [Fact]
    public async Task DeactivateUser_Unknown_IsNotFound()
    {
        SignInAdmin();

        await Assert.ThrowsAsync<NotFoundException>(() =>
            _h.DeactivateUser().HandleAsync(new DeactivateUserCommand(Guid.NewGuid()), CancellationToken.None));
    }

    [Fact]
    public async Task ResetPassword_SetsTemporaryPassword_MustChange_AndRevokesTokens()
    {
        var target = _h.AddUser("target@example.com");
        await _h.Login().HandleAsync(new LoginCommand("target@example.com", TestHarness.DefaultPassword), CancellationToken.None);
        SignInAdmin();

        var result = await _h.ResetPassword().HandleAsync(new ResetPasswordCommand(target.Id), CancellationToken.None);

        Assert.True(target.MustChangePassword);
        Assert.True(_h.Hasher.Verify(target.PasswordHash, result.TemporaryPassword));
        Assert.All(_h.Db.RefreshTokens, t => Assert.NotNull(t.RevokedAt));
        var entry = Assert.Single(_h.Audit.Entries, e => e.Action == AuditActions.PasswordReset);
        Assert.DoesNotContain(result.TemporaryPassword, entry.DetailsJson ?? string.Empty);
    }

    [Fact]
    public async Task ResetPassword_ByNonAdmin_IsDenied()
    {
        var target = _h.AddUser("target@example.com");
        _h.SignInAs(_h.AddUser("user@example.com"));

        await Assert.ThrowsAsync<AccessDeniedException>(() =>
            _h.ResetPassword().HandleAsync(new ResetPasswordCommand(target.Id), CancellationToken.None));
    }

    [Theory]
    [InlineData("")]
    [InlineData("a")]
    [InlineData(" b ")]
    public async Task SearchDirectory_ShortQuery_Fails(string query)
    {
        _h.AddUser("abby@example.com", "Abby");

        await Assert.ThrowsAsync<ValidationException>(() =>
            _h.SearchDirectory().HandleAsync(new SearchUserDirectoryQuery(query), CancellationToken.None));
    }

    [Fact]
    public async Task SearchDirectory_MatchesNameOrEmail_ActiveOnly_Max20()
    {
        for (var i = 0; i < 25; i++)
        {
            _h.AddUser($"match{i:D2}@example.com", $"Person {i}");
        }

        _h.AddUser("zed@example.com", "Matcher Inactive", active: false);
        _h.AddUser("other@example.com", "Mateo MATCH");
        _h.AddUser("nope@example.com", "Unrelated");

        var results = await _h.SearchDirectory().HandleAsync(new SearchUserDirectoryQuery("MATCH"), CancellationToken.None);

        Assert.Equal(20, results.Count);
        Assert.DoesNotContain(results, r => r.Email == "zed@example.com");
        Assert.DoesNotContain(results, r => r.Email == "nope@example.com");

        var byName = await _h.SearchDirectory().HandleAsync(new SearchUserDirectoryQuery("mateo"), CancellationToken.None);
        var single = Assert.Single(byName);
        Assert.Equal("other@example.com", single.Email);
        Assert.Equal("Mateo MATCH", single.DisplayName);
    }
}
