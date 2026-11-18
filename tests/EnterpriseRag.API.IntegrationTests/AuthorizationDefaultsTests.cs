using System.Net;
using System.Text;
using EnterpriseRag.API.IntegrationTests.Support;
using EnterpriseRag.Domain.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace EnterpriseRag.API.IntegrationTests;

[Collection(ApiDatabaseCollection.Name)]
public sealed class AuthorizationDefaultsTests(ApiDatabaseFixture db) : IAsyncLifetime
{
    private const string Password = "User-Password-123";

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

    [Theory]
    [InlineData("/")]
    [InlineData("/health/live")]
    [InlineData("/health/ready")]
    public async Task Health_And_Root_AreAnonymous(string url)
    {
        var response = await _client.GetAsync(url);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("GET", "/api/me")]
    [InlineData("POST", "/api/auth/password")]
    public async Task ProtectedEndpoint_WithoutToken_Returns401(string method, string url)
    {
        var response = await AuthHttp.SendAsync(_client, new HttpMethod(method), url,
            body: method == "POST" ? new { currentPassword = "x", newPassword = "y" } : null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData("wrong-key")]
    [InlineData("wrong-issuer")]
    [InlineData("wrong-audience")]
    [InlineData("expired")]
    [InlineData("garbage")]
    public async Task ProtectedEndpoint_WithInvalidToken_Returns401(string kind)
    {
        var email = ApiDatabaseFixture.UniqueEmail("user");
        var id = await ApiDatabaseFixture.CreateUserAsync(_factory, email, Password);
        var now = DateTime.UtcNow;
        var token = kind == "garbage"
            ? "not-a-jwt"
            : Mint(id,
                key: kind == "wrong-key" ? "another-signing-key-that-is-at-least-32-bytes" : ApiFactory.TestSigningKey,
                issuer: kind == "wrong-issuer" ? "evil" : ApiFactory.TestIssuer,
                audience: kind == "wrong-audience" ? "evil" : ApiFactory.TestIssuer,
                expires: kind == "expired" ? now.AddMinutes(-2) : now.AddMinutes(5),
                issuedAt: now.AddMinutes(-10));

        var response = await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/me", token);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ProtectedEndpoint_WithMintedValidToken_Returns200()
    {
        // Positive control for the invalid-token theory: the same minting with the right parameters is accepted.
        var id = await ApiDatabaseFixture.CreateUserAsync(_factory, ApiDatabaseFixture.UniqueEmail("user"), Password);
        var now = DateTime.UtcNow;
        var token = Mint(id, ApiFactory.TestSigningKey, ApiFactory.TestIssuer, ApiFactory.TestIssuer, now.AddMinutes(5), now);

        var response = await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/me", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task ProtectedEndpoint_WithDeactivatedUserToken_Returns401()
    {
        var email = ApiDatabaseFixture.UniqueEmail("user");
        var id = await ApiDatabaseFixture.CreateUserAsync(_factory, email, Password);
        var login = await AuthHttp.LoginAsync(_client, email, Password);
        Assert.Equal(HttpStatusCode.OK, (await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/me", login.AccessToken)).StatusCode);

        await ApiDatabaseFixture.WithDbAsync(_factory, async d =>
        {
            var user = await d.Users.SingleAsync(u => u.Id == id);
            user.Deactivate();
            return await d.SaveChangesAsync();
        });

        var response = await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/me", login.AccessToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ProtectedEndpoint_WithDeletedUserToken_Returns401()
    {
        var email = ApiDatabaseFixture.UniqueEmail("user");
        var id = await ApiDatabaseFixture.CreateUserAsync(_factory, email, Password);
        var login = await AuthHttp.LoginAsync(_client, email, Password);

        await ApiDatabaseFixture.WithDbAsync(_factory, async d =>
        {
            var user = await d.Users.SingleAsync(u => u.Id == id);
            user.MarkDeleted(DateTime.UtcNow);
            return await d.SaveChangesAsync();
        });

        var response = await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/me", login.AccessToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task AdminOnlyPolicy_RequiresAdminRoleClaim()
    {
        var provider = _factory.Services.GetRequiredService<IAuthorizationPolicyProvider>();

        var policy = await provider.GetPolicyAsync("AdminOnly");

        Assert.NotNull(policy);
        Assert.Contains(policy.Requirements, r => r is Microsoft.AspNetCore.Authorization.Infrastructure.DenyAnonymousAuthorizationRequirement);
        var roles = Assert.Single(policy.Requirements.OfType<Microsoft.AspNetCore.Authorization.Infrastructure.ClaimsAuthorizationRequirement>());
        Assert.Equal("role", roles.ClaimType);
        Assert.Equal(["Admin"], roles.AllowedValues);

        var fallback = await provider.GetFallbackPolicyAsync();
        Assert.NotNull(fallback);
        Assert.Contains(fallback.Requirements, r => r is Microsoft.AspNetCore.Authorization.Infrastructure.DenyAnonymousAuthorizationRequirement);
    }

    [Fact]
    public async Task ProtectedEndpoint_WithHs512Token_Returns401()
    {
        // Same secret, different algorithm: only HS256 is accepted.
        var id = await ApiDatabaseFixture.CreateUserAsync(_factory, ApiDatabaseFixture.UniqueEmail("user"), Password);
        var now = DateTime.UtcNow;
        var key = ApiFactory.TestSigningKey + ApiFactory.TestSigningKey; // >= 512 bits so HS512 can sign
        var token = Mint(id, key, ApiFactory.TestIssuer, ApiFactory.TestIssuer, now.AddMinutes(5), now, SecurityAlgorithms.HmacSha512);

        var response = await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/me", token);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ProtectedEndpoint_WithAlgNoneToken_Returns401()
    {
        var id = await ApiDatabaseFixture.CreateUserAsync(_factory, ApiDatabaseFixture.UniqueEmail("user"), Password);
        var now = DateTimeOffset.UtcNow;
        static string B64(string json) => Base64UrlEncoder.Encode(json);
        var token = B64("{\"alg\":\"none\",\"typ\":\"JWT\"}") + "." + B64(
            $"{{\"sub\":\"{id}\",\"role\":\"User\",\"iss\":\"{ApiFactory.TestIssuer}\",\"aud\":\"{ApiFactory.TestIssuer}\"," +
            $"\"iat\":{now.ToUnixTimeSeconds()},\"nbf\":{now.ToUnixTimeSeconds()},\"exp\":{now.AddMinutes(5).ToUnixTimeSeconds()}}}") + ".";

        var response = await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/me", token);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task UnmatchedRoute_Returns401ToAnonymous_And404ToAuthenticated()
    {
        // The fallback policy also covers requests that match no endpoint, so anonymous callers cannot probe routes.
        var email = ApiDatabaseFixture.UniqueEmail("user");
        await ApiDatabaseFixture.CreateUserAsync(_factory, email, Password);
        var login = await AuthHttp.LoginAsync(_client, email, Password);

        var anonymous = await _client.GetAsync("/api/does-not-exist");
        var authenticated = await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/does-not-exist", login.AccessToken);

        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, authenticated.StatusCode);
    }

    [Fact]
    public async Task AdminOnlyEndpoint_AdminToken_Works_UserToken_Forbidden()
    {
        var adminEmail = ApiDatabaseFixture.UniqueEmail("admin");
        await ApiDatabaseFixture.CreateUserAsync(_factory, adminEmail, Password, GlobalRole.Admin);
        var userEmail = ApiDatabaseFixture.UniqueEmail("user");
        await ApiDatabaseFixture.CreateUserAsync(_factory, userEmail, Password);
        var admin = await AuthHttp.LoginAsync(_client, adminEmail, Password);
        var user = await AuthHttp.LoginAsync(_client, userEmail, Password);

        Assert.Equal(HttpStatusCode.OK, (await AuthHttp.SendAsync(_client, HttpMethod.Get, "/test/admin-only", admin.AccessToken)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await AuthHttp.SendAsync(_client, HttpMethod.Get, "/test/admin-only", user.AccessToken)).StatusCode);
    }

    [Fact]
    public async Task DemotedAdmin_ExistingToken_Returns401()
    {
        // Authorization comes from SQL: a token whose role claim no longer matches the stored role is rejected.
        var email = ApiDatabaseFixture.UniqueEmail("admin");
        var id = await ApiDatabaseFixture.CreateUserAsync(_factory, email, Password, GlobalRole.Admin);
        var login = await AuthHttp.LoginAsync(_client, email, Password);
        Assert.Equal(HttpStatusCode.OK, (await AuthHttp.SendAsync(_client, HttpMethod.Get, "/test/admin-only", login.AccessToken)).StatusCode);

        await ApiDatabaseFixture.WithDbAsync(_factory, async d =>
        {
            var user = await d.Users.SingleAsync(u => u.Id == id);
            d.Entry(user).Property(u => u.GlobalRole).CurrentValue = GlobalRole.User;
            return await d.SaveChangesAsync();
        });

        Assert.Equal(HttpStatusCode.Unauthorized, (await AuthHttp.SendAsync(_client, HttpMethod.Get, "/test/admin-only", login.AccessToken)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/me", login.AccessToken)).StatusCode);
    }

    [Fact]
    public async Task TokenWithMissingRoleClaim_Returns401()
    {
        var id = await ApiDatabaseFixture.CreateUserAsync(_factory, ApiDatabaseFixture.UniqueEmail("user"), Password);
        var now = DateTime.UtcNow;
        var token = Mint(id, ApiFactory.TestSigningKey, ApiFactory.TestIssuer, ApiFactory.TestIssuer, now.AddMinutes(5), now, role: null);

        var response = await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/me", token);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    internal static string Mint(
        Guid userId, string key, string issuer, string audience, DateTime expires, DateTime issuedAt,
        string algorithm = SecurityAlgorithms.HmacSha256, string? role = "User")
    {
        var claims = new Dictionary<string, object> { ["sub"] = userId.ToString() };
        if (role is not null)
        {
            claims["role"] = role;
        }

        return new JsonWebTokenHandler { SetDefaultTimesOnTokenCreation = false }.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            IssuedAt = issuedAt,
            NotBefore = issuedAt,
            Expires = expires,
            Claims = claims,
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)), algorithm),
        });
    }
}
