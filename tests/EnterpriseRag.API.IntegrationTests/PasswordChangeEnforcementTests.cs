using System.Net;
using System.Text.Json;
using EnterpriseRag.API.Auth;
using EnterpriseRag.API.Http;
using EnterpriseRag.API.IntegrationTests.Support;
using EnterpriseRag.Domain.Identity;
using EnterpriseRag.Domain.KnowledgeBases;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Microsoft.Extensions.DependencyInjection;
using static EnterpriseRag.API.IntegrationTests.Support.KnowledgeBaseApi;

namespace EnterpriseRag.API.IntegrationTests;

/// <summary>
/// <c>mustChangePassword</c> is enforced by the server: a user holding a temporary password can only change it, read
/// <c>/api/me</c> and use the anonymous token endpoints. The flag is read from SQL on every request.
/// </summary>
[Collection(ApiDatabaseCollection.Name)]
public sealed class PasswordChangeEnforcementTests(ApiDatabaseFixture db) : IAsyncLifetime
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

    private async Task<(Guid Id, string Email)> NewUserAsync(bool mustChange, GlobalRole role = GlobalRole.User)
    {
        var email = ApiDatabaseFixture.UniqueEmail("mcp");
        var id = await ApiDatabaseFixture.CreateUserAsync(_factory, email, Password, role, mustChange);
        return (id, email);
    }

    private static async Task AssertPasswordChangeRequiredAsync(HttpResponseMessage response, string what)
    {
        Assert.True(response.StatusCode == HttpStatusCode.Forbidden, $"{what} -> {response.StatusCode}");
        Assert.True(response.Content.Headers.ContentType?.MediaType == "application/problem+json", $"{what}: content type {response.Content.Headers.ContentType}");
        var body = await JsonAsync(response);
        Assert.Equal(ProblemTypes.PasswordChangeRequired, body.GetProperty("type").GetString());
        Assert.Equal(403, body.GetProperty("status").GetInt32());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("title").GetString()));
        Assert.False(string.IsNullOrEmpty(body.GetProperty("correlationId").GetString()));
    }

    [Fact]
    public async Task MustChange_User_GetsPasswordChangeRequired403_OnProtectedEndpoints()
    {
        var (_, email) = await NewUserAsync(mustChange: true);
        var (_, adminEmail) = await NewUserAsync(mustChange: true, GlobalRole.Admin);
        var user = await AuthHttp.LoginAsync(_client, email, Password);
        var admin = await AuthHttp.LoginAsync(_client, adminEmail, Password);
        Assert.True(user.Body.GetProperty("mustChangePassword").GetBoolean());

        await AssertPasswordChangeRequiredAsync(await SendAsync(_client, HttpMethod.Get, Root, user.AccessToken), "GET kbs");
        await AssertPasswordChangeRequiredAsync(
            await SendAsync(_client, HttpMethod.Post, Root, user.AccessToken, new { name = "Blocked" }), "POST kb");
        await AssertPasswordChangeRequiredAsync(
            await SendAsync(_client, HttpMethod.Get, "/api/users/directory?query=ab", user.AccessToken), "directory");
        await AssertPasswordChangeRequiredAsync(
            await SendAsync(_client, HttpMethod.Get, "/api/admin/users", admin.AccessToken), "admin list (Admin role)");
        await AssertPasswordChangeRequiredAsync(
            await SendAsync(_client, HttpMethod.Get, Root, admin.AccessToken), "GET kbs (Admin role)");
    }

    [Fact]
    public async Task MustChange_SeededAdmin_IsBlockedFromAdminEndpoints_UntilPasswordChanged()
    {
        await using var factory = new ApiFactory(connectionString: await db.CreateDatabaseAsync("seeded_block"));
        using var client = AuthHttp.CreateClient(factory);
        var login = await AuthHttp.LoginAsync(client, ApiDatabaseFixture.AdminEmail, ApiDatabaseFixture.AdminPassword);
        Assert.True(login.Body.GetProperty("mustChangePassword").GetBoolean());

        await AssertPasswordChangeRequiredAsync(
            await SendAsync(client, HttpMethod.Get, "/api/admin/users", login.AccessToken), "admin list");
        await AssertPasswordChangeRequiredAsync(
            await SendAsync(client, HttpMethod.Post, "/api/admin/users", login.AccessToken,
                new { email = "x@example.com", displayName = "X", globalRole = "User" }), "admin create");

        var change = await AuthHttp.SendAsync(client, HttpMethod.Post, "/api/auth/password", login.AccessToken, login.RefreshToken,
            new { currentPassword = ApiDatabaseFixture.AdminPassword, newPassword = ApiDatabaseFixture.AdminWorkingPassword });
        Assert.Equal(HttpStatusCode.NoContent, change.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(client, HttpMethod.Get, "/api/admin/users", login.AccessToken)).StatusCode);
    }

    [Fact]
    public async Task MustChange_User_CanCallChangePasswordAndMe_AndAnonymousTokenEndpoints()
    {
        var (_, email) = await NewUserAsync(mustChange: true);
        var login = await AuthHttp.LoginAsync(_client, email, Password);

        var me = await SendAsync(_client, HttpMethod.Get, "/api/me", login.AccessToken);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        Assert.True((await JsonAsync(me)).GetProperty("mustChangePassword").GetBoolean());

        // Refresh stays reachable (anonymous) and still reports the flag.
        var refreshed = await AuthHttp.RefreshAsync(_client, login.RefreshToken);
        Assert.Equal(HttpStatusCode.OK, refreshed.Response.StatusCode);
        Assert.True(refreshed.Body.GetProperty("mustChangePassword").GetBoolean());

        var change = await AuthHttp.SendAsync(_client, HttpMethod.Post, "/api/auth/password", refreshed.AccessToken, refreshed.RefreshToken,
            new { currentPassword = Password, newPassword = NewPassword });
        Assert.Equal(HttpStatusCode.NoContent, change.StatusCode);

        // Logout stays reachable for a must-change user (even with the Bearer header attached).
        var (_, other) = await NewUserAsync(mustChange: true);
        var otherLogin = await AuthHttp.LoginAsync(_client, other, Password);
        var logout = await AuthHttp.SendAsync(_client, HttpMethod.Post, "/api/auth/logout", otherLogin.AccessToken, otherLogin.RefreshToken);
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_ClearsFlag_SameTokenWorksNext()
    {
        var (_, email) = await NewUserAsync(mustChange: true);
        var login = await AuthHttp.LoginAsync(_client, email, Password);

        await AssertPasswordChangeRequiredAsync(await SendAsync(_client, HttpMethod.Get, Root, login.AccessToken), "before change");

        var change = await AuthHttp.SendAsync(_client, HttpMethod.Post, "/api/auth/password", login.AccessToken, login.RefreshToken,
            new { currentPassword = Password, newPassword = NewPassword });
        Assert.Equal(HttpStatusCode.NoContent, change.StatusCode);

        // Same access token, no re-login.
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(_client, HttpMethod.Get, Root, login.AccessToken)).StatusCode);
    }

    [Fact]
    public async Task ResetPassword_MakesExistingTokenForbidden()
    {
        var (id, email) = await NewUserAsync(mustChange: false);
        var login = await AuthHttp.LoginAsync(_client, email, Password);
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(_client, HttpMethod.Get, Root, login.AccessToken)).StatusCode);

        var admin = await ApiDatabaseFixture.AdminTokenAsync(_client);
        var reset = await AuthHttp.SendAsync(_client, HttpMethod.Post, $"/api/admin/users/{id}/reset-password", admin);
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);

        // The access token issued before the reset is still signed and unexpired, but is blocked immediately.
        await AssertPasswordChangeRequiredAsync(await SendAsync(_client, HttpMethod.Get, Root, login.AccessToken), "after reset");
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(_client, HttpMethod.Get, "/api/me", login.AccessToken)).StatusCode);
    }

    [Fact]
    public async Task ForgedMustChangeClaimInToken_IsIgnored()
    {
        var (mustChangeId, _) = await NewUserAsync(mustChange: true);
        var (normalId, _) = await NewUserAsync(mustChange: false);
        var now = DateTime.UtcNow;
        string MintWith(Guid id, string value) => AuthorizationDefaultsTests.Mint(
            id, ApiFactory.TestSigningKey, ApiFactory.TestIssuer, ApiFactory.TestIssuer, now.AddMinutes(5), now,
            extraClaims: new Dictionary<string, object> { [PasswordChangeClaims.ClaimType] = value });

        // A token claiming "false" does not lift the block (SQL says true) ...
        await AssertPasswordChangeRequiredAsync(
            await SendAsync(_client, HttpMethod.Get, Root, MintWith(mustChangeId, "false")), "claims false");
        // ... and a token claiming "true" does not impose it (SQL says false).
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(_client, HttpMethod.Get, Root, MintWith(normalId, "true"))).StatusCode);
    }

    [Fact]
    public async Task PasswordChangeRequired403_IsDistinguishableFromOrdinaryForbidden()
    {
        var owner = await KnowledgeBaseApi.CreateUserAsync(_factory, "owner");
        var viewer = await KnowledgeBaseApi.CreateUserAsync(_factory, "viewer");
        var (kb, rowVersion) = await CreateKbAsync(_client, owner.Token);
        await AddMemberAsync(_client, owner.Token, kb, viewer.Id, KnowledgeBaseRole.Viewer);
        rowVersion = await RowVersionAsync(_client, owner.Token, kb);
        var (_, email) = await NewUserAsync(mustChange: true);
        var blocked = await AuthHttp.LoginAsync(_client, email, Password);

        var viewerForbidden = await SendAsync(_client, HttpMethod.Put, $"{Root}/{kb}", viewer.Token, new { name = "X" }, Quote(rowVersion));
        var nonAdminForbidden = await SendAsync(_client, HttpMethod.Get, "/api/admin/users", viewer.Token);
        var mustChange = await SendAsync(_client, HttpMethod.Get, Root, blocked.AccessToken);

        Assert.Equal(HttpStatusCode.Forbidden, viewerForbidden.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, nonAdminForbidden.StatusCode);
        Assert.Equal(ProblemTypes.Forbidden, (await JsonAsync(viewerForbidden)).GetProperty("type").GetString());
        Assert.Equal(ProblemTypes.Forbidden, (await JsonAsync(nonAdminForbidden)).GetProperty("type").GetString());
        await AssertPasswordChangeRequiredAsync(mustChange, "must change");
        Assert.NotEqual(ProblemTypes.Forbidden, ProblemTypes.PasswordChangeRequired);
    }

    [Fact]
    public async Task DefaultFallbackAndAdminPolicies_AllCarryThePasswordChangeRequirement()
    {
        var provider = _factory.Services.GetRequiredService<IAuthorizationPolicyProvider>();

        var policies = new[]
        {
            await provider.GetDefaultPolicyAsync(),
            await provider.GetFallbackPolicyAsync(),
            await provider.GetPolicyAsync(AuthenticationSetup.AdminOnlyPolicy),
        };

        Assert.All(policies, p => Assert.Contains(p!.Requirements, r => r is PasswordChangeRequiredRequirement));
    }

    [Fact]
    public async Task EveryAuthenticatedEndpoint_IsAllowlistedOrBlockedForMustChangeUser()
    {
        var (id, _) = await NewUserAsync(mustChange: true);
        var token = await TokenForAsync(_factory, id);
        var endpoints = _factory.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>().ToList();

        var allowlisted = new List<string>();
        var blocked = 0;
        foreach (var endpoint in endpoints)
        {
            if (endpoint.Metadata.GetMetadata<IAllowAnonymous>() is not null)
            {
                continue;
            }

            var url = "/" + BuildPath(endpoint.RoutePattern);
            var methods = endpoint.Metadata.GetMetadata<Microsoft.AspNetCore.Routing.HttpMethodMetadata>()?.HttpMethods ?? ["GET"];
            foreach (var method in methods)
            {
                if (endpoint.Metadata.GetMetadata<AllowWhilePasswordChangeRequiredAttribute>() is not null)
                {
                    allowlisted.Add($"{method} {endpoint.RoutePattern.RawText}");
                    continue;
                }

                var body = method is "POST" or "PUT" ? new { } : null;
                await AssertPasswordChangeRequiredAsync(
                    await SendAsync(_client, new HttpMethod(method), url, token, body), $"{method} {endpoint.RoutePattern.RawText}");
                blocked++;
            }
        }

        Assert.Equal(["GET api/me", "POST api/auth/password"], allowlisted.Order(StringComparer.Ordinal).ToArray());
        Assert.True(blocked >= 15, $"only {blocked} endpoints were exercised");
    }

    private static string BuildPath(RoutePattern pattern) =>
        string.Join("/", pattern.PathSegments.Select(segment => string.Concat(segment.Parts.Select(part => part switch
        {
            RoutePatternLiteralPart literal => literal.Content,
            RoutePatternSeparatorPart separator => separator.Content,
            RoutePatternParameterPart parameter when parameter.ParameterPolicies.Any(p => p.Content == "guid") => Guid.NewGuid().ToString(),
            RoutePatternParameterPart => "x",
            _ => string.Empty,
        }))));
}
