using System.Net;
using System.Text.Json;
using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Domain.Identity;
using EnterpriseRag.Domain.KnowledgeBases;
using EnterpriseRag.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace EnterpriseRag.API.IntegrationTests.Support;

/// <summary>A test user: id plus an access token minted by the real token service (validated against SQL per request).</summary>
public sealed record TestUser(Guid Id, string Email, string Token);

/// <summary>What a knowledge base looks like in SQL; used to prove rejected requests changed nothing.</summary>
public sealed record KbSnapshot(string Name, string? Description, bool IsDeleted, int PermissionVersion, string Members);

/// <summary>Helpers for the knowledge-base endpoint tests.</summary>
public static class KnowledgeBaseApi
{
    public const string Password = "Kb-User-Password-123";
    public const string Root = "/api/knowledge-bases";

    /// <summary>Creates an active user and mints an access token for them (no login, so no login rate limit).</summary>
    public static async Task<TestUser> CreateUserAsync(ApiFactory factory, string prefix, GlobalRole role = GlobalRole.User)
    {
        var email = ApiDatabaseFixture.UniqueEmail(prefix);
        var id = await ApiDatabaseFixture.CreateUserAsync(factory, email, Password, role);
        return new TestUser(id, email, await TokenForAsync(factory, id));
    }

    public static async Task<string> TokenForAsync(ApiFactory factory, Guid userId)
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.SingleAsync(u => u.Id == userId);
        return scope.ServiceProvider.GetRequiredService<ITokenService>().CreateAccessToken(user).Value;
    }

    public static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        return JsonDocument.Parse(text).RootElement.Clone();
    }

    /// <summary>Creates a KB over HTTP; returns its id and base64 row version.</summary>
    public static async Task<(Guid Id, string RowVersion)> CreateKbAsync(HttpClient client, string token, string name = "Docs")
    {
        var response = await AuthHttp.SendAsync(client, HttpMethod.Post, Root, token, body: new { name, description = "d" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await JsonAsync(response);
        return (body.GetProperty("id").GetGuid(), body.GetProperty("rowVersion").GetString()!);
    }

    public static async Task AddMemberAsync(HttpClient client, string ownerToken, Guid kbId, Guid userId, KnowledgeBaseRole role)
    {
        var response = await AuthHttp.SendAsync(client, HttpMethod.Post, $"{Root}/{kbId}/members", ownerToken,
            body: new { userId, role = role.ToString() });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    public static async Task<string> RowVersionAsync(HttpClient client, string token, Guid kbId)
    {
        var response = await AuthHttp.SendAsync(client, HttpMethod.Get, $"{Root}/{kbId}", token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await JsonAsync(response)).GetProperty("rowVersion").GetString()!;
    }

    /// <summary>Sends a request with optional JSON body and optional raw <c>If-Match</c> header.</summary>
    public static Task<HttpResponseMessage> SendAsync(
        HttpClient client, HttpMethod method, string url, string? token, object? body = null, string? ifMatch = null)
    {
        var request = new HttpRequestMessage(method, url);
        if (token is not null)
        {
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        }

        if (body is not null)
        {
            request.Content = System.Net.Http.Json.JsonContent.Create(body);
        }

        if (ifMatch is not null)
        {
            request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        }

        return client.SendAsync(request);
    }

    public static string Quote(string rowVersion) => $"\"{rowVersion}\"";

    /// <summary>Reads the KB straight from SQL (soft-deleted rows included).</summary>
    public static Task<KbSnapshot> SnapshotAsync(ApiFactory factory, Guid kbId) =>
        ApiDatabaseFixture.WithDbAsync(factory, async db =>
        {
            var kb = await db.KnowledgeBases.IgnoreQueryFilters().AsNoTracking().SingleAsync(k => k.Id == kbId);
            var members = await db.KnowledgeBaseUsers.AsNoTracking()
                .Where(m => m.KnowledgeBaseId == kbId)
                .OrderBy(m => m.UserId)
                .Select(m => new { m.UserId, m.Role })
                .ToListAsync();
            return new KbSnapshot(kb.Name, kb.Description, kb.IsDeleted, kb.PermissionVersion,
                string.Join(",", members.Select(m => $"{m.UserId}:{m.Role}")));
        });

    public static Task<int> PermissionVersionAsync(ApiFactory factory, Guid kbId) =>
        ApiDatabaseFixture.WithDbAsync(factory, db =>
            db.KnowledgeBases.IgnoreQueryFilters().Where(k => k.Id == kbId).Select(k => k.PermissionVersion).SingleAsync());

    /// <summary>A ProblemDetails body without the per-request fields, for byte-for-byte comparison.</summary>
    public static string NormalizeProblem(JsonElement body) =>
        JsonSerializer.Serialize(body.EnumerateObject()
            .Where(p => p.Name is not ("correlationId" or "traceId"))
            .OrderBy(p => p.Name, StringComparer.Ordinal)
            .ToDictionary(p => p.Name, p => p.Value.GetRawText()));
}
