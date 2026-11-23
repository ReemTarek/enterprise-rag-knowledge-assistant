using System.Net;
using EnterpriseRag.API.IntegrationTests.Support;
using EnterpriseRag.Domain.KnowledgeBases;
using static EnterpriseRag.API.IntegrationTests.Support.KnowledgeBaseApi;

namespace EnterpriseRag.API.IntegrationTests;

/// <summary>
/// Every knowledge-base and membership endpoint × every persona, against real SQL. Non-members get 404 (never 403),
/// members with an insufficient role get 403, anonymous callers get 401. Any rejected request must leave the knowledge
/// base untouched in SQL.
/// </summary>
[Collection(ApiDatabaseCollection.Name)]
public sealed class KnowledgeBaseAuthorizationMatrixTests(ApiDatabaseFixture db) : IAsyncLifetime
{
    public enum Persona { Anonymous, NonMember, Viewer, Editor, Owner }

    /// <summary>The world a request runs in. <c>Other*</c> is a second KB owned by the non-member persona.</summary>
    private sealed record World(
        Guid Kb, string RowVersion, Guid Target, Guid Candidate, Guid OtherKb, Guid OtherKbMember);

    private sealed record Endpoint(HttpMethod Method, Func<World, string> Url, Func<World, object?> Body, bool IfMatch = false);

    // ------------------------------------------------------------------------------------------------------------
    // THE MATRIX: endpoint → expected status for Anonymous / NonMember / Viewer / Editor / Owner.
    // "Target" is a Viewer member of the KB; "Candidate" is an active user who is not yet a member.
    // "*_OtherKbMember" rows aim at a user who is a member of a DIFFERENT knowledge base (IDOR via member ids).
    // "*_ViaOtherKb" rows use the non-member's own KB route to try to touch a member of the victim KB.
    // ------------------------------------------------------------------------------------------------------------
    private static readonly Dictionary<string, (Endpoint Endpoint, int[] Expected)> Matrix = new()
    {
        ["ListKbs"] = (new(HttpMethod.Get, _ => Root, _ => null), [401, 200, 200, 200, 200]),
        ["CreateKb"] = (new(HttpMethod.Post, _ => Root, _ => new { name = "New KB", description = (string?)null }), [401, 201, 201, 201, 201]),
        ["GetKb"] = (new(HttpMethod.Get, w => $"{Root}/{w.Kb}", _ => null), [401, 404, 200, 200, 200]),
        ["UpdateKb"] = (new(HttpMethod.Put, w => $"{Root}/{w.Kb}", _ => new { name = "Renamed", description = "x" }, IfMatch: true), [401, 404, 403, 403, 200]),
        ["DeleteKb"] = (new(HttpMethod.Delete, w => $"{Root}/{w.Kb}", _ => null), [401, 404, 403, 403, 204]),
        ["ListMembers"] = (new(HttpMethod.Get, w => $"{Root}/{w.Kb}/members", _ => null), [401, 404, 200, 200, 200]),
        ["AddMember"] = (new(HttpMethod.Post, w => $"{Root}/{w.Kb}/members", w => new { userId = w.Candidate, role = "Viewer" }), [401, 404, 403, 403, 201]),
        ["ChangeMemberRole"] = (new(HttpMethod.Put, w => $"{Root}/{w.Kb}/members/{w.Target}", _ => new { role = "Editor" }), [401, 404, 403, 403, 200]),
        ["RemoveMember"] = (new(HttpMethod.Delete, w => $"{Root}/{w.Kb}/members/{w.Target}", _ => null), [401, 404, 403, 403, 204]),
        ["ChangeMemberRole_OtherKbMember"] = (new(HttpMethod.Put, w => $"{Root}/{w.Kb}/members/{w.OtherKbMember}", _ => new { role = "Owner" }), [401, 404, 403, 403, 404]),
        ["RemoveMember_OtherKbMember"] = (new(HttpMethod.Delete, w => $"{Root}/{w.Kb}/members/{w.OtherKbMember}", _ => null), [401, 404, 403, 403, 404]),
        ["ChangeMemberRole_ViaOtherKb"] = (new(HttpMethod.Put, w => $"{Root}/{w.OtherKb}/members/{w.Target}", _ => new { role = "Owner" }), [401, 404, 404, 404, 404]),
        ["RemoveMember_ViaOtherKb"] = (new(HttpMethod.Delete, w => $"{Root}/{w.OtherKb}/members/{w.Target}", _ => null), [401, 404, 404, 404, 404]),
    };

    public static TheoryData<string, Persona> Cases()
    {
        var data = new TheoryData<string, Persona>();
        foreach (var name in Matrix.Keys)
        {
            foreach (var persona in Enum.GetValues<Persona>())
            {
                data.Add(name, persona);
            }
        }

        return data;
    }

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
    [MemberData(nameof(Cases))]
    public async Task Endpoint_ReturnsExpectedStatus_ForPersona(string endpointName, Persona persona)
    {
        var owner = await CreateUserAsync(_factory, "owner");
        var editor = await CreateUserAsync(_factory, "editor");
        var viewer = await CreateUserAsync(_factory, "viewer");
        var target = await CreateUserAsync(_factory, "target");
        var candidate = await CreateUserAsync(_factory, "candidate");
        var nonMember = await CreateUserAsync(_factory, "nonmember");
        var otherKbMember = await CreateUserAsync(_factory, "othermember");

        var (kb, _) = await CreateKbAsync(_client, owner.Token, "Victim KB");
        await AddMemberAsync(_client, owner.Token, kb, editor.Id, KnowledgeBaseRole.Editor);
        await AddMemberAsync(_client, owner.Token, kb, viewer.Id, KnowledgeBaseRole.Viewer);
        await AddMemberAsync(_client, owner.Token, kb, target.Id, KnowledgeBaseRole.Viewer);
        var (otherKb, _) = await CreateKbAsync(_client, nonMember.Token, "Non-member's own KB");
        await AddMemberAsync(_client, nonMember.Token, otherKb, otherKbMember.Id, KnowledgeBaseRole.Viewer);

        var world = new World(kb, await RowVersionAsync(_client, owner.Token, kb), target.Id, candidate.Id, otherKb, otherKbMember.Id);
        var token = persona switch
        {
            Persona.Anonymous => null,
            Persona.NonMember => nonMember.Token,
            Persona.Viewer => viewer.Token,
            Persona.Editor => editor.Token,
            _ => owner.Token,
        };

        var (endpoint, expectedByPersona) = Matrix[endpointName];
        var expected = expectedByPersona[(int)persona];
        var before = await SnapshotAsync(_factory, kb);
        var otherBefore = await SnapshotAsync(_factory, otherKb);

        var response = await SendAsync(_client, endpoint.Method, endpoint.Url(world), token,
            endpoint.Body(world), endpoint.IfMatch ? Quote(world.RowVersion) : null);

        Assert.True((int)response.StatusCode == expected,
            $"{endpointName} as {persona}: expected {expected}, got {(int)response.StatusCode} {await response.Content.ReadAsStringAsync()}");
        if (expected >= 400)
        {
            Assert.Equal(before, await SnapshotAsync(_factory, kb));
            Assert.Equal(otherBefore, await SnapshotAsync(_factory, otherKb));
            Assert.False(response.Headers.Contains("ETag"));
            Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        }

        if (expected == (int)HttpStatusCode.NotFound)
        {
            // Never leaks whether the KB exists.
            var body = await JsonAsync(response);
            var detail = body.GetProperty("detail").GetString();
            Assert.True(detail is "Knowledge base not found." or "Member not found.", detail);
        }
    }
}
