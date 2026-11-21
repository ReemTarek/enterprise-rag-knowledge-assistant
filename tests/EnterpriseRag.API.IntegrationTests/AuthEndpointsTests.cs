using System.Globalization;
using System.Net;
using System.Text.Json;
using EnterpriseRag.API.IntegrationTests.Support;
using EnterpriseRag.Application.Common;
using Microsoft.EntityFrameworkCore;

namespace EnterpriseRag.API.IntegrationTests;

[Collection(ApiDatabaseCollection.Name)]
public sealed class AuthEndpointsTests(ApiDatabaseFixture db) : IAsyncLifetime
{
    private const string Password = "User-Password-123";
    private const string NewPassword = "Changed-Password-456";

    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    public Task InitializeAsync()
    {
        _factory = db.CreateFactory();
        _client = AuthHttp.CreateClient(_factory);
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    private async Task<(Guid Id, string Email)> NewUserAsync(bool mustChangePassword = false)
    {
        var email = ApiDatabaseFixture.UniqueEmail("user");
        var id = await ApiDatabaseFixture.CreateUserAsync(_factory, email, Password, mustChangePassword: mustChangePassword);
        return (id, email);
    }

    [Fact]
    public async Task Login_Valid_ReturnsAccessToken_AndHttpOnlyRefreshCookie()
    {
        var (_, email) = await NewUserAsync();
        var before = DateTime.UtcNow;

        var login = await AuthHttp.LoginAsync(_client, email, Password);

        Assert.Equal(HttpStatusCode.OK, login.Response.StatusCode);
        Assert.False(string.IsNullOrWhiteSpace(login.AccessToken));
        Assert.False(login.Body.GetProperty("mustChangePassword").GetBoolean());
        var expiresAt = login.Body.GetProperty("expiresAtUtc").GetDateTime();
        Assert.InRange(expiresAt, before.AddMinutes(14), before.AddMinutes(16));
        Assert.Equal(3, login.Body.EnumerateObject().Count()); // never the refresh token

        Assert.NotNull(login.SetCookie);
        Assert.False(string.IsNullOrEmpty(login.RefreshToken));
        Assert.DoesNotContain(login.RefreshToken!, login.Body.GetRawText());
        var attributes = AuthHttp.CookieAttributes(login.SetCookie!);
        Assert.True(attributes.ContainsKey("httponly"));
        Assert.True(attributes.ContainsKey("secure"));
        Assert.Equal("strict", attributes["samesite"], ignoreCase: true);
        Assert.Equal("/api/auth", attributes["path"]);
        var cookieExpires = DateTime.Parse(attributes["expires"]!, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal);
        Assert.InRange(cookieExpires, before.AddDays(7).AddMinutes(-1), before.AddDays(7).AddMinutes(1));
    }

    [Fact]
    public async Task Login_SeededAdmin_MustChangePassword()
    {
        // A fresh database: the shared one's seeded admin has already changed its password (fixture).
        await using var factory = new ApiFactory(connectionString: await db.CreateDatabaseAsync("seeded_admin"));
        using var client = AuthHttp.CreateClient(factory);
        var login = await AuthHttp.LoginAsync(client, ApiDatabaseFixture.AdminEmail, ApiDatabaseFixture.AdminPassword);

        Assert.Equal(HttpStatusCode.OK, login.Response.StatusCode);
        Assert.True(login.Body.GetProperty("mustChangePassword").GetBoolean());
    }

    [Fact]
    public async Task Login_Invalid_Returns401_WithGenericProblemDetails()
    {
        var (_, email) = await NewUserAsync();

        var wrongPassword = await AuthHttp.LoginAsync(_client, email, "Wrong-Password-999");
        var unknownEmail = await AuthHttp.LoginAsync(_client, ApiDatabaseFixture.UniqueEmail("nobody"), Password);

        foreach (var response in new[] { wrongPassword, unknownEmail })
        {
            Assert.Equal(HttpStatusCode.Unauthorized, response.Response.StatusCode);
            Assert.Equal("application/problem+json", response.Response.Content.Headers.ContentType?.MediaType);
            Assert.Null(response.SetCookie);
            Assert.Equal(401, response.Body.GetProperty("status").GetInt32());
            Assert.Equal("Invalid credentials.", response.Body.GetProperty("detail").GetString());
            Assert.True(response.Body.TryGetProperty("correlationId", out _));
            Assert.DoesNotContain("Wrong-Password-999", response.Body.GetRawText());
        }

        Assert.Equal(Comparable(wrongPassword.Body), Comparable(unknownEmail.Body));
    }

    [Fact]
    public async Task Login_RateLimited_After10Attempts_Returns429()
    {
        var email = ApiDatabaseFixture.UniqueEmail("nobody");
        for (var i = 0; i < 10; i++)
        {
            var attempt = await AuthHttp.LoginAsync(_client, email, Password);
            Assert.Equal(HttpStatusCode.Unauthorized, attempt.Response.StatusCode);
        }

        var limited = await AuthHttp.LoginAsync(_client, email, Password);

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.Response.StatusCode);
        Assert.Equal("application/problem+json", limited.Response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(429, limited.Body.GetProperty("status").GetInt32());
        Assert.True(limited.Body.TryGetProperty("correlationId", out _));
    }

    [Fact]
    public async Task ChangePassword_RateLimited_After10AttemptsPerMinute_Returns429()
    {
        // The password endpoint is a current-password oracle, so it shares the login limit (10/min per IP).
        var (id, _) = await NewUserAsync();
        var token = await KnowledgeBaseApi.TokenForAsync(_factory, id); // minted: no login consumes the bucket
        for (var i = 0; i < 10; i++)
        {
            var attempt = await AuthHttp.SendAsync(_client, HttpMethod.Post, "/api/auth/password", token,
                body: new { currentPassword = "Wrong-Password-999", newPassword = NewPassword });
            Assert.Equal(HttpStatusCode.BadRequest, attempt.StatusCode);
        }

        var limited = await AuthHttp.SendAsync(_client, HttpMethod.Post, "/api/auth/password", token,
            body: new { currentPassword = Password, newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.True(limited.Headers.Contains("Retry-After"));
    }

    [Fact]
    public async Task Refresh_WithCookie_RotatesCookie()
    {
        var (_, email) = await NewUserAsync();
        var login = await AuthHttp.LoginAsync(_client, email, Password);

        var refreshed = await AuthHttp.RefreshAsync(_client, login.RefreshToken);

        Assert.Equal(HttpStatusCode.OK, refreshed.Response.StatusCode);
        Assert.NotNull(refreshed.RefreshToken);
        Assert.NotEqual(login.RefreshToken, refreshed.RefreshToken);
        Assert.Equal("/api/auth", AuthHttp.CookieAttributes(refreshed.SetCookie!)["path"]);
        Assert.Equal(3, refreshed.Body.EnumerateObject().Count());
        var me = await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/me", refreshed.AccessToken);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
    }

    [Fact]
    public async Task Refresh_ReusedOldCookie_Returns401_AndFamilyRevoked()
    {
        var (userId, email) = await NewUserAsync();
        var login = await AuthHttp.LoginAsync(_client, email, Password);
        var rotated = await AuthHttp.RefreshAsync(_client, login.RefreshToken);
        Assert.Equal(HttpStatusCode.OK, rotated.Response.StatusCode);

        var reuse = await AuthHttp.RefreshAsync(_client, login.RefreshToken);

        Assert.Equal(HttpStatusCode.Unauthorized, reuse.Response.StatusCode);
        Assert.Equal("Invalid credentials.", reuse.Body.GetProperty("detail").GetString());
        var successor = await AuthHttp.RefreshAsync(_client, rotated.RefreshToken);
        Assert.Equal(HttpStatusCode.Unauthorized, successor.Response.StatusCode);
        var active = await ApiDatabaseFixture.WithDbAsync(_factory, d =>
            d.RefreshTokens.CountAsync(t => t.UserId == userId && t.RevokedAt == null));
        Assert.Equal(0, active);
    }

    [Fact]
    public async Task Refresh_ReadsOnlyTheCookie_NeverTheBody()
    {
        var (_, email) = await NewUserAsync();
        var login = await AuthHttp.LoginAsync(_client, email, Password);

        var viaBody = await AuthHttp.RefreshAsync(_client, refreshToken: null, body: new { refreshToken = login.RefreshToken });

        Assert.Equal(HttpStatusCode.Unauthorized, viaBody.Response.StatusCode);
        Assert.Null(viaBody.SetCookie);
    }

    [Fact]
    public async Task Logout_RevokesFamily_AndClearsCookie()
    {
        var (_, email) = await NewUserAsync();
        var login = await AuthHttp.LoginAsync(_client, email, Password);

        var logout = await AuthHttp.SendAsync(_client, HttpMethod.Post, "/api/auth/logout", login.AccessToken, login.RefreshToken);

        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        var cleared = AuthHttp.RefreshSetCookie(logout);
        Assert.NotNull(cleared);
        Assert.Equal(string.Empty, AuthHttp.CookieValue(cleared));
        var attributes = AuthHttp.CookieAttributes(cleared!);
        Assert.Equal("/api/auth", attributes["path"]);
        Assert.True(DateTime.Parse(attributes["expires"]!, CultureInfo.InvariantCulture) < DateTime.UtcNow);
        var refresh = await AuthHttp.RefreshAsync(_client, login.RefreshToken);
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.Response.StatusCode);
    }

    [Theory]
    [InlineData("none")]
    [InlineData("garbage")]
    [InlineData("expired")]
    public async Task Logout_IsAnonymous_CookieIsTheCredential(string accessTokenKind)
    {
        var (userId, email) = await NewUserAsync();
        var login = await AuthHttp.LoginAsync(_client, email, Password);
        var accessToken = accessTokenKind switch
        {
            "garbage" => "not-a-jwt",
            "expired" => AuthorizationDefaultsTests.Mint(userId, ApiFactory.TestSigningKey, ApiFactory.TestIssuer,
                ApiFactory.TestIssuer, DateTime.UtcNow.AddMinutes(-5), DateTime.UtcNow.AddMinutes(-20)),
            _ => null,
        };

        var logout = await AuthHttp.SendAsync(_client, HttpMethod.Post, "/api/auth/logout", accessToken, login.RefreshToken);

        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        AssertClearedCookie(logout);
        var active = await ApiDatabaseFixture.WithDbAsync(_factory, d =>
            d.RefreshTokens.CountAsync(t => t.UserId == userId && t.RevokedAt == null));
        Assert.Equal(0, active);
    }

    [Fact]
    public async Task Logout_WithoutCookie_Succeeds_AndRevokesNothing()
    {
        var (userId, email) = await NewUserAsync();
        await AuthHttp.LoginAsync(_client, email, Password);

        var logout = await AuthHttp.SendAsync(_client, HttpMethod.Post, "/api/auth/logout");

        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        AssertClearedCookie(logout);
        var active = await ApiDatabaseFixture.WithDbAsync(_factory, d =>
            d.RefreshTokens.CountAsync(t => t.UserId == userId && t.RevokedAt == null));
        Assert.Equal(1, active);
    }

    [Fact]
    public async Task Logout_IsRateLimited_LikeRefresh()
    {
        for (var i = 0; i < 30; i++)
        {
            Assert.Equal(HttpStatusCode.NoContent, (await AuthHttp.SendAsync(_client, HttpMethod.Post, "/api/auth/logout")).StatusCode);
        }

        var limited = await AuthHttp.SendAsync(_client, HttpMethod.Post, "/api/auth/logout");

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_WithoutCookie_RevokesAllFamilies()
    {
        var (userId, email) = await NewUserAsync();
        var first = await AuthHttp.LoginAsync(_client, email, Password);
        await AuthHttp.LoginAsync(_client, email, Password);

        var change = await AuthHttp.SendAsync(_client, HttpMethod.Post, "/api/auth/password", first.AccessToken,
            body: new { currentPassword = Password, newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.NoContent, change.StatusCode);
        var (total, active) = await ApiDatabaseFixture.WithDbAsync(_factory, async d =>
            (await d.RefreshTokens.CountAsync(t => t.UserId == userId),
             await d.RefreshTokens.CountAsync(t => t.UserId == userId && t.RevokedAt == null)));
        Assert.Equal(2, total);
        Assert.Equal(0, active);
    }

    [Fact]
    public async Task ChangePassword_OldMeRoute_IsGone()
    {
        var (_, email) = await NewUserAsync();
        var login = await AuthHttp.LoginAsync(_client, email, Password);

        var response = await AuthHttp.SendAsync(_client, HttpMethod.Post, "/api/me/password", login.AccessToken,
            body: new { currentPassword = Password, newPassword = NewPassword });

        Assert.True(response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed, response.StatusCode.ToString());
    }

    private static void AssertClearedCookie(HttpResponseMessage response)
    {
        var cleared = AuthHttp.RefreshSetCookie(response);
        Assert.NotNull(cleared);
        Assert.Equal(string.Empty, AuthHttp.CookieValue(cleared));
        var attributes = AuthHttp.CookieAttributes(cleared!);
        Assert.Equal("/api/auth", attributes["path"]);
        Assert.True(attributes.ContainsKey("secure"));
        Assert.True(attributes.ContainsKey("httponly"));
        Assert.Equal("strict", attributes["samesite"], ignoreCase: true);
        Assert.True(DateTime.Parse(attributes["expires"]!, CultureInfo.InvariantCulture) < DateTime.UtcNow);
    }

    [Fact]
    public async Task Me_ReturnsProfile_FromToken()
    {
        var (id, email) = await NewUserAsync(mustChangePassword: true);
        var login = await AuthHttp.LoginAsync(_client, email, Password);

        var response = await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/me", login.AccessToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var me = doc.RootElement;
        Assert.Equal(id, me.GetProperty("id").GetGuid());
        Assert.Equal(email, me.GetProperty("email").GetString());
        Assert.Equal("Test User", me.GetProperty("displayName").GetString());
        Assert.Equal("User", me.GetProperty("globalRole").GetString());
        Assert.True(me.GetProperty("mustChangePassword").GetBoolean());
        Assert.Equal(5, me.EnumerateObject().Count());
    }

    [Fact]
    public async Task ChangePassword_EndsOtherSessions_KeepsCurrent()
    {
        var (_, email) = await NewUserAsync(mustChangePassword: true);
        var current = await AuthHttp.LoginAsync(_client, email, Password);
        var other = await AuthHttp.LoginAsync(_client, email, Password);

        var change = await AuthHttp.SendAsync(_client, HttpMethod.Post, "/api/auth/password", current.AccessToken, current.RefreshToken,
            new { currentPassword = Password, newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.NoContent, change.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await AuthHttp.RefreshAsync(_client, current.RefreshToken)).Response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await AuthHttp.RefreshAsync(_client, other.RefreshToken)).Response.StatusCode);

        var relogin = await AuthHttp.LoginAsync(_client, email, NewPassword);
        Assert.Equal(HttpStatusCode.OK, relogin.Response.StatusCode);
        Assert.False(relogin.Body.GetProperty("mustChangePassword").GetBoolean());
        Assert.Equal(HttpStatusCode.Unauthorized, (await AuthHttp.LoginAsync(_client, email, Password)).Response.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_WrongCurrentPassword_Returns400_WithFieldErrors_NoValuesEchoed()
    {
        var (_, email) = await NewUserAsync();
        var login = await AuthHttp.LoginAsync(_client, email, Password);

        var response = await AuthHttp.SendAsync(_client, HttpMethod.Post, "/api/auth/password", login.AccessToken,
            body: new { currentPassword = "Not-My-Password-77", newPassword = "weak" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var text = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("Not-My-Password-77", text);
        Assert.DoesNotContain("\"weak\"", text);
        using var doc = JsonDocument.Parse(text);
        var errors = doc.RootElement.GetProperty("errors");
        Assert.True(errors.TryGetProperty("NewPassword", out var messages));
        Assert.True(messages.GetArrayLength() > 0);
        Assert.True(doc.RootElement.TryGetProperty("correlationId", out _));
    }

    [Fact]
    public async Task CreatedBy_IsFilledFromToken_ForAuditedEntity()
    {
        // No endpoint creates an auditable entity yet (admin user creation arrives in Task 5), so this asserts the same
        // token-to-actor plumbing on what exists: the User row's UpdatedBy and the audit entry's ActorId after a
        // password change made with the caller's access token.
        var (id, email) = await NewUserAsync();
        var login = await AuthHttp.LoginAsync(_client, email, Password);

        var change = await AuthHttp.SendAsync(_client, HttpMethod.Post, "/api/auth/password", login.AccessToken,
            body: new { currentPassword = Password, newPassword = NewPassword });
        Assert.Equal(HttpStatusCode.NoContent, change.StatusCode);

        var (updatedBy, actor) = await ApiDatabaseFixture.WithDbAsync(_factory, async d =>
        {
            var user = await d.Users.AsNoTracking().SingleAsync(u => u.Id == id);
            var entry = await d.AuditLogs.AsNoTracking()
                .SingleAsync(a => a.Action == AuditActions.PasswordChanged && a.TargetId == id.ToString());
            return (user.UpdatedBy, entry.ActorId);
        });
        Assert.Equal(id.ToString(), updatedBy);
        Assert.Equal(id.ToString(), actor);
    }

    private static string Comparable(JsonElement problem) =>
        JsonSerializer.Serialize(problem.EnumerateObject()
            .Where(p => p.Name is not ("correlationId" or "traceId"))
            .ToDictionary(p => p.Name, p => p.Value.ToString()));
}
