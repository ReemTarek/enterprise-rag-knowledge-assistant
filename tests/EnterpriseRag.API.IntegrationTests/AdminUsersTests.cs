using System.Net;
using System.Text.Json;
using EnterpriseRag.API.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;
using Serilog.Core;
using Serilog.Events;

namespace EnterpriseRag.API.IntegrationTests;

[Collection(ApiDatabaseCollection.Name)]
public sealed class AdminUsersTests(ApiDatabaseFixture db) : IAsyncLifetime
{
    private const string UserPassword = "User-Password-123";

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

    private Task<string> AdminTokenAsync() => ApiDatabaseFixture.AdminTokenAsync(_client);

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();

    private static Task<HttpResponseMessage> CreateAsync(HttpClient client, string token, string email, string role = "User") =>
        AuthHttp.SendAsync(client, HttpMethod.Post, "/api/admin/users", token,
            body: new { email, displayName = "Created User", globalRole = role });

    private static IEnumerable<(HttpMethod Method, string Url, object? Body)> AdminRoutes(Guid id) =>
    [
        (HttpMethod.Post, "/api/admin/users", new { email = "x@example.com", displayName = "X", globalRole = "User" }),
        (HttpMethod.Get, "/api/admin/users", null),
        (HttpMethod.Post, $"/api/admin/users/{id}/deactivate", null),
        (HttpMethod.Post, $"/api/admin/users/{id}/reset-password", null),
    ];

    [Fact]
    public async Task AdminEndpoints_AsNormalUser_Return403()
    {
        var email = ApiDatabaseFixture.UniqueEmail("user");
        await ApiDatabaseFixture.CreateUserAsync(_factory, email, UserPassword);
        var token = (await AuthHttp.LoginAsync(_client, email, UserPassword)).AccessToken;

        foreach (var (method, url, body) in AdminRoutes(Guid.NewGuid()))
        {
            var response = await AuthHttp.SendAsync(_client, method, url, token, body: body);
            Assert.True(response.StatusCode == HttpStatusCode.Forbidden, $"{method} {url} -> {response.StatusCode}");
        }
    }

    [Fact]
    public async Task AdminEndpoints_Anonymous_Return401()
    {
        var routes = AdminRoutes(Guid.NewGuid()).Append((HttpMethod.Get, "/api/users/directory?query=ab", null));
        foreach (var (method, url, body) in routes)
        {
            var response = await AuthHttp.SendAsync(_client, method, url, body: body);
            Assert.True(response.StatusCode == HttpStatusCode.Unauthorized, $"{method} {url} -> {response.StatusCode}");
        }
    }

    [Fact]
    public async Task CreateUser_ThenLoginWithTemporaryPassword_Succeeds_AndForcesPasswordChange()
    {
        var admin = await AdminTokenAsync();
        var email = ApiDatabaseFixture.UniqueEmail("new");

        var created = await CreateAsync(_client, admin, email);

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Contains("no-store", created.Headers.CacheControl?.ToString());
        var body = await JsonAsync(created);
        Assert.Equal(email, body.GetProperty("email").GetString());
        var temp = body.GetProperty("temporaryPassword").GetString()!;

        var login = await AuthHttp.LoginAsync(_client, email, temp);
        Assert.Equal(HttpStatusCode.OK, login.Response.StatusCode);
        Assert.True(login.Body.GetProperty("mustChangePassword").GetBoolean());

        // Forced: until the change, protected endpoints answer 403 password-change-required.
        var blocked = await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/knowledge-bases", login.AccessToken);
        Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);
        Assert.Equal(EnterpriseRag.API.Http.ProblemTypes.PasswordChangeRequired, (await JsonAsync(blocked)).GetProperty("type").GetString());

        var change = await AuthHttp.SendAsync(_client, HttpMethod.Post, "/api/auth/password", login.AccessToken,
            login.RefreshToken, new { currentPassword = temp, newPassword = "Brand-New-Password-9" });
        Assert.Equal(HttpStatusCode.NoContent, change.StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/knowledge-bases", login.AccessToken)).StatusCode);

        var again = await AuthHttp.LoginAsync(_client, email, "Brand-New-Password-9");
        Assert.Equal(HttpStatusCode.OK, again.Response.StatusCode);
        Assert.False(again.Body.GetProperty("mustChangePassword").GetBoolean());
    }

    [Fact]
    public async Task TemporaryPassword_NeverAppearsInLogs()
    {
        var sink = new CapturingSink();
        using var factory = db.CreateFactory().WithWebHostBuilder(b =>
            b.ConfigureServices(s => s.AddSingleton<ILogEventSink>(sink)));
        using var client = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions { HandleCookies = false });
        var admin = await ApiDatabaseFixture.AdminTokenAsync(client);

        var created = await CreateAsync(client, admin, ApiDatabaseFixture.UniqueEmail("logs"));
        var createdBody = await JsonAsync(created);
        var temp1 = createdBody.GetProperty("temporaryPassword").GetString()!;
        var id = createdBody.GetProperty("id").GetGuid();
        var reset = await AuthHttp.SendAsync(client, HttpMethod.Post, $"/api/admin/users/{id}/reset-password", admin);
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
        Assert.Contains("no-store", reset.Headers.CacheControl?.ToString());
        var temp2 = (await JsonAsync(reset)).GetProperty("temporaryPassword").GetString()!;

        Assert.NotEmpty(sink.Events); // the capture works (request logging at least)
        foreach (var e in sink.Events)
        {
            var text = e.RenderMessage() + " " + string.Join(' ', e.Properties.Select(p => p.Value.ToString())) + " " + e.Exception;
            Assert.DoesNotContain(temp1, text);
            Assert.DoesNotContain(temp2, text);
        }
    }

    [Fact]
    public async Task DeactivatedUser_CannotLogin()
    {
        var email = ApiDatabaseFixture.UniqueEmail("gone");
        var id = await ApiDatabaseFixture.CreateUserAsync(_factory, email, UserPassword);
        var userLogin = await AuthHttp.LoginAsync(_client, email, UserPassword);
        var admin = await AdminTokenAsync();

        var response = await AuthHttp.SendAsync(_client, HttpMethod.Post, $"/api/admin/users/{id}/deactivate", admin);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await AuthHttp.LoginAsync(_client, email, UserPassword)).Response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/me", userLogin.AccessToken)).StatusCode);
    }

    [Fact]
    public async Task CreateUser_DuplicateEmail_Returns409()
    {
        var admin = await AdminTokenAsync();
        var email = ApiDatabaseFixture.UniqueEmail("dup");
        Assert.Equal(HttpStatusCode.Created, (await CreateAsync(_client, admin, email)).StatusCode);

        var second = await CreateAsync(_client, admin, email.ToUpperInvariant());

        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task CreateUser_InvalidEmail_Returns400_WithoutEchoingValue()
    {
        var admin = await AdminTokenAsync();

        var response = await CreateAsync(_client, admin, "not-an-email-SENTINEL");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.DoesNotContain("SENTINEL", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task AdminList_IsPaged_AndCapsPageSize100()
    {
        var admin = await AdminTokenAsync();
        for (var i = 0; i < 3; i++)
        {
            await CreateAsync(_client, admin, ApiDatabaseFixture.UniqueEmail("paged"));
        }

        var paged = await JsonAsync(await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/admin/users?page=1&pageSize=2", admin));
        Assert.Equal(2, paged.GetProperty("items").GetArrayLength());
        Assert.Equal(2, paged.GetProperty("pageSize").GetInt32());
        Assert.True(paged.GetProperty("totalCount").GetInt32() >= 4);

        var capped = await JsonAsync(await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/admin/users?pageSize=1000", admin));
        Assert.Equal(100, capped.GetProperty("pageSize").GetInt32());
    }

    [Fact]
    public async Task AdminList_HugePage_Returns200_WithEmptyPage()
    {
        var admin = await AdminTokenAsync();

        var response = await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/admin/users?page=2147483647&pageSize=100", admin);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await JsonAsync(response);
        Assert.Equal(0, body.GetProperty("items").GetArrayLength());
        Assert.True(body.GetProperty("totalCount").GetInt32() >= 1);
    }

    [Theory]
    [InlineData(1)] // a defined value (Admin) as an integer
    [InlineData(2)] // undefined
    public async Task CreateUser_IntegerGlobalRole_Returns400(int role)
    {
        var admin = await AdminTokenAsync();
        var email = ApiDatabaseFixture.UniqueEmail("introle");

        var response = await AuthHttp.SendAsync(_client, HttpMethod.Post, "/api/admin/users", admin,
            body: new { email, displayName = "Int Role", globalRole = role });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await CreateAsync(_client, admin, email, "Admin")).StatusCode); // strings work
    }

    [Fact]
    public async Task AdminCannotDeactivateSelf()
    {
        var admin = await AdminTokenAsync();
        var me = await JsonAsync(await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/me", admin));
        var id = me.GetProperty("id").GetGuid();

        var response = await AuthHttp.SendAsync(_client, HttpMethod.Post, $"/api/admin/users/{id}/deactivate", admin);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/me", admin)).StatusCode);
    }

    private sealed class CapturingSink : ILogEventSink
    {
        private readonly List<LogEvent> _events = [];

        public IReadOnlyList<LogEvent> Events
        {
            get
            {
                lock (_events)
                {
                    return [.. _events];
                }
            }
        }

        public void Emit(LogEvent logEvent)
        {
            lock (_events)
            {
                _events.Add(logEvent);
            }
        }
    }
}
