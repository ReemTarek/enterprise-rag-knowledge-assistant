using System.Net;
using System.Text;
using System.Text.Json;
using EnterpriseRag.API.Http;
using EnterpriseRag.API.IntegrationTests.Support;
using EnterpriseRag.Domain.KnowledgeBases;
using static EnterpriseRag.API.IntegrationTests.Support.KnowledgeBaseApi;

namespace EnterpriseRag.API.IntegrationTests;

/// <summary>
/// The error contract: every ProblemDetails body carries a stable <c>type</c> from <see cref="ProblemTypes"/>, a
/// <c>title</c>, the <c>status</c>, the <c>correlationId</c> (equal to the X-Correlation-ID header) and a <c>traceId</c>.
/// </summary>
[Collection(ApiDatabaseCollection.Name)]
public sealed class ErrorContractTests(ApiDatabaseFixture db) : IAsyncLifetime
{
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

    [Fact]
    public async Task EveryMainErrorResponse_CarriesTypeTitleStatusCorrelationAndTraceId()
    {
        var owner = await CreateUserAsync(_factory, "owner");
        var viewer = await CreateUserAsync(_factory, "viewer");
        var (kb, stale) = await CreateKbAsync(_client, owner.Token);
        await AddMemberAsync(_client, owner.Token, kb, viewer.Id, KnowledgeBaseRole.Viewer);
        var current = await RowVersionAsync(_client, owner.Token, kb);
        var mustChangeEmail = ApiDatabaseFixture.UniqueEmail("mcp");
        await ApiDatabaseFixture.CreateUserAsync(_factory, mustChangeEmail, Password, mustChangePassword: true);
        var mustChange = await AuthHttp.LoginAsync(_client, mustChangeEmail, Password);

        using var malformed = new HttpRequestMessage(HttpMethod.Post, Root)
        {
            Content = new StringContent("{ not json", Encoding.UTF8, "application/json"),
        };
        malformed.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", owner.Token);

        var cases = new List<(string Name, HttpResponseMessage Response, int Status, string Type)>
        {
            ("malformed json", await _client.SendAsync(malformed), 400, ProblemTypes.Validation),
            ("fluent validation", await SendAsync(_client, HttpMethod.Post, Root, owner.Token, new { name = "   " }), 400, ProblemTypes.Validation),
            ("bad If-Match", await SendAsync(_client, HttpMethod.Put, $"{Root}/{kb}", owner.Token, new { name = "X" }, "*"), 400, ProblemTypes.BadRequest),
            ("business rule", await _client.GetAsync("/test/domain"), 400, ProblemTypes.BusinessRule),
            ("no token", await SendAsync(_client, HttpMethod.Get, Root, null), 401, ProblemTypes.Unauthorized),
            ("bad credentials", (await AuthHttp.LoginAsync(_client, owner.Email, "Wrong-Password-1")).Response, 401, ProblemTypes.Unauthorized),
            ("viewer forbidden", await SendAsync(_client, HttpMethod.Delete, $"{Root}/{kb}", viewer.Token), 403, ProblemTypes.Forbidden),
            ("non-admin", await SendAsync(_client, HttpMethod.Get, "/api/admin/users", viewer.Token), 403, ProblemTypes.Forbidden),
            ("must change", await SendAsync(_client, HttpMethod.Get, Root, mustChange.AccessToken), 403, ProblemTypes.PasswordChangeRequired),
            ("not found", await SendAsync(_client, HttpMethod.Get, $"{Root}/{Guid.NewGuid()}", owner.Token), 404, ProblemTypes.NotFound),
            ("conflict", await SendAsync(_client, HttpMethod.Post, $"{Root}/{kb}/members", owner.Token, new { userId = viewer.Id, role = "Editor" }), 409, ProblemTypes.Conflict),
            ("stale If-Match", await SendAsync(_client, HttpMethod.Put, $"{Root}/{kb}", owner.Token, new { name = "Y" }, Quote(stale)), 412, ProblemTypes.PreconditionFailed),
            ("no If-Match", await SendAsync(_client, HttpMethod.Put, $"{Root}/{kb}", owner.Token, new { name = "Y" }), 428, ProblemTypes.PreconditionRequired),
            ("server error", await _client.GetAsync("/test/throw"), 500, ProblemTypes.InternalError),
        };
        Assert.NotEqual(stale, current);

        // 429: exhaust the login bucket (10/min per IP, shared with this factory's earlier logins).
        HttpResponseMessage limited;
        do
        {
            limited = (await AuthHttp.LoginAsync(_client, "nobody@example.com", "Wrong-Password-1")).Response;
        }
        while (limited.StatusCode != HttpStatusCode.TooManyRequests);
        cases.Add(("rate limited", limited, 429, ProblemTypes.TooManyRequests));

        foreach (var (name, response, status, type) in cases)
        {
            Assert.True((int)response.StatusCode == status, $"{name}: {(int)response.StatusCode}");
            Assert.True(response.Content.Headers.ContentType?.MediaType == "application/problem+json", $"{name}: content type");
            var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
            Assert.True(body.GetProperty("type").GetString() == type, $"{name}: type {body.GetProperty("type").GetString()}");
            Assert.True(!string.IsNullOrWhiteSpace(body.GetProperty("title").GetString()), $"{name}: title");
            Assert.Equal(status, body.GetProperty("status").GetInt32());
            var correlationId = body.GetProperty("correlationId").GetString();
            Assert.True(!string.IsNullOrEmpty(correlationId), $"{name}: correlationId");
            Assert.Equal(correlationId, Assert.Single(response.Headers.GetValues("X-Correlation-ID")));
            Assert.True(body.TryGetProperty("traceId", out _), $"{name}: traceId");
        }

        // Every type is from the documented scheme.
        Assert.All(cases, c => Assert.StartsWith(ProblemTypes.Base, c.Type, StringComparison.Ordinal));
    }

    private const string Password = "Contract-Password-123";
}
