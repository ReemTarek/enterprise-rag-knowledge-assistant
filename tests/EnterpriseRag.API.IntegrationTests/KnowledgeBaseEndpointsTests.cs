using System.Net;
using System.Text.Json;
using EnterpriseRag.API.IntegrationTests.Support;
using EnterpriseRag.Application.Common;
using EnterpriseRag.Domain.KnowledgeBases;
using Microsoft.EntityFrameworkCore;
using static EnterpriseRag.API.IntegrationTests.Support.KnowledgeBaseApi;

namespace EnterpriseRag.API.IntegrationTests;

[Collection(ApiDatabaseCollection.Name)]
public sealed class KnowledgeBaseEndpointsTests(ApiDatabaseFixture db) : IAsyncLifetime
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

    /// <summary>Every KB-scoped endpoint (the ones that take a KB id), with a valid body.</summary>
    private static IEnumerable<(HttpMethod Method, string Url, object? Body, string? IfMatch)> KbScopedRoutes(Guid kb, Guid member, Guid candidate, string rowVersion) =>
    [
        (HttpMethod.Get, $"{Root}/{kb}", null, null),
        (HttpMethod.Put, $"{Root}/{kb}", new { name = "Hijacked", description = "x" }, Quote(rowVersion)),
        (HttpMethod.Delete, $"{Root}/{kb}", null, null),
        (HttpMethod.Get, $"{Root}/{kb}/members", null, null),
        (HttpMethod.Post, $"{Root}/{kb}/members", new { userId = candidate, role = "Owner" }, null),
        (HttpMethod.Put, $"{Root}/{kb}/members/{member}", new { role = "Owner" }, null),
        (HttpMethod.Delete, $"{Root}/{kb}/members/{member}", null, null),
    ];

    [Fact]
    public async Task Create_ReturnsKbWithOwnerRole_RowVersion_AndETag()
    {
        var owner = await CreateUserAsync(_factory, "owner");

        var response = await SendAsync(_client, HttpMethod.Post, Root, owner.Token, new { name = "  Handbook ", description = "HR" });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = await JsonAsync(response);
        var id = body.GetProperty("id").GetGuid();
        Assert.Equal("Handbook", body.GetProperty("name").GetString());
        Assert.Equal("Owner", body.GetProperty("myRole").GetString());
        var rowVersion = body.GetProperty("rowVersion").GetString()!;
        Assert.Equal(Quote(rowVersion), response.Headers.ETag?.ToString());
        Assert.EndsWith($"{Root}/{id}", response.Headers.Location?.ToString(), StringComparison.OrdinalIgnoreCase);

        var get = await SendAsync(_client, HttpMethod.Get, $"{Root}/{id}", owner.Token);
        Assert.Equal(Quote(rowVersion), get.Headers.ETag?.ToString());
    }

    [Fact]
    public async Task Create_InvalidName_Returns400()
    {
        var owner = await CreateUserAsync(_factory, "owner");

        var response = await SendAsync(_client, HttpMethod.Post, Root, owner.Token, new { name = "   " });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task NonMember_GetsSame404Body_AsMissingKb()
    {
        var owner = await CreateUserAsync(_factory, "owner");
        var member = await CreateUserAsync(_factory, "member");
        var candidate = await CreateUserAsync(_factory, "candidate");
        var stranger = await CreateUserAsync(_factory, "stranger");
        var (kb, rowVersion) = await CreateKbAsync(_client, owner.Token);
        await AddMemberAsync(_client, owner.Token, kb, member.Id, KnowledgeBaseRole.Viewer);
        rowVersion = await RowVersionAsync(_client, owner.Token, kb);

        var real = KbScopedRoutes(kb, member.Id, candidate.Id, rowVersion).ToList();
        var missing = KbScopedRoutes(Guid.NewGuid(), member.Id, candidate.Id, rowVersion).ToList();
        for (var i = 0; i < real.Count; i++)
        {
            var a = await SendAsync(_client, real[i].Method, real[i].Url, stranger.Token, real[i].Body, real[i].IfMatch);
            var b = await SendAsync(_client, missing[i].Method, missing[i].Url, stranger.Token, missing[i].Body, missing[i].IfMatch);

            Assert.Equal(HttpStatusCode.NotFound, a.StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, b.StatusCode);
            Assert.Equal(NormalizeProblem(await JsonAsync(b)), NormalizeProblem(await JsonAsync(a)));
            Assert.Equal(b.Content.Headers.ContentType?.ToString(), a.Content.Headers.ContentType?.ToString());
            Assert.Null(a.Headers.ETag);
            Assert.Null(b.Headers.ETag);
            Assert.Equal(
                b.Headers.Select(h => h.Key).Where(k => k != "X-Correlation-Id").OrderBy(k => k),
                a.Headers.Select(h => h.Key).Where(k => k != "X-Correlation-Id").OrderBy(k => k));
        }
    }

    [Fact]
    public async Task ListKnowledgeBases_NeverContainsOthersKbs()
    {
        var alice = await CreateUserAsync(_factory, "alice");
        var bob = await CreateUserAsync(_factory, "bob");
        var aliceKbs = new List<Guid>();
        for (var i = 0; i < 3; i++)
        {
            aliceKbs.Add((await CreateKbAsync(_client, alice.Token, $"Alice {i}")).Id);
        }

        var bobKb = (await CreateKbAsync(_client, bob.Token, "Bob")).Id;

        var aliceSeen = new List<Guid>();
        for (var page = 1; page <= 2; page++)
        {
            var response = await SendAsync(_client, HttpMethod.Get, $"{Root}?page={page}&pageSize=2", alice.Token);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var body = await JsonAsync(response);
            Assert.Equal(3, body.GetProperty("totalCount").GetInt32());
            Assert.Equal(page, body.GetProperty("page").GetInt32());
            Assert.Equal(2, body.GetProperty("pageSize").GetInt32());
            aliceSeen.AddRange(body.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("id").GetGuid()));
        }

        Assert.Equal(aliceKbs.Order(), aliceSeen.Order());
        Assert.DoesNotContain(bobKb, aliceSeen);

        var bobList = await JsonAsync(await SendAsync(_client, HttpMethod.Get, Root, bob.Token));
        var bobItems = bobList.GetProperty("items").EnumerateArray().Select(e => e.GetProperty("id").GetGuid()).ToList();
        Assert.Equal([bobKb], bobItems);
        Assert.Equal(1, bobList.GetProperty("totalCount").GetInt32());

        // Being added as a member makes it show up, with the member's role.
        await AddMemberAsync(_client, alice.Token, aliceKbs[0], bob.Id, KnowledgeBaseRole.Viewer);
        bobList = await JsonAsync(await SendAsync(_client, HttpMethod.Get, Root, bob.Token));
        var shared = bobList.GetProperty("items").EnumerateArray().Single(e => e.GetProperty("id").GetGuid() == aliceKbs[0]);
        Assert.Equal("Viewer", shared.GetProperty("myRole").GetString());
        Assert.Equal(2, bobList.GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task List_HugePage_Returns200_WithEmptyPage()
    {
        var owner = await CreateUserAsync(_factory, "owner");
        await CreateKbAsync(_client, owner.Token);

        var response = await SendAsync(_client, HttpMethod.Get, $"{Root}?page=2147483647", owner.Token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await JsonAsync(response);
        Assert.Equal(0, body.GetProperty("items").GetArrayLength());
        Assert.Equal(1, body.GetProperty("totalCount").GetInt32());
    }

    [Fact]
    public async Task Update_WithCurrentRowVersion_Returns200_WithNewETag()
    {
        var owner = await CreateUserAsync(_factory, "owner");
        var (kb, rowVersion) = await CreateKbAsync(_client, owner.Token);

        var response = await SendAsync(_client, HttpMethod.Put, $"{Root}/{kb}", owner.Token,
            new { name = "Renamed", description = "new" }, Quote(rowVersion));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await JsonAsync(response);
        Assert.Equal("Renamed", body.GetProperty("name").GetString());
        var newVersion = body.GetProperty("rowVersion").GetString()!;
        Assert.NotEqual(rowVersion, newVersion);
        Assert.Equal(Quote(newVersion), response.Headers.ETag?.ToString());
        Assert.Equal("Renamed", (await SnapshotAsync(_factory, kb)).Name);
    }

    [Fact]
    public async Task Update_WithStaleRowVersion_Returns412()
    {
        var owner = await CreateUserAsync(_factory, "owner");
        var (kb, stale) = await CreateKbAsync(_client, owner.Token);
        var first = await SendAsync(_client, HttpMethod.Put, $"{Root}/{kb}", owner.Token, new { name = "First" }, Quote(stale));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var second = await SendAsync(_client, HttpMethod.Put, $"{Root}/{kb}", owner.Token, new { name = "Second" }, Quote(stale));

        Assert.Equal(HttpStatusCode.PreconditionFailed, second.StatusCode);
        var body = await JsonAsync(second);
        Assert.Equal(412, body.GetProperty("status").GetInt32());
        Assert.True(body.TryGetProperty("correlationId", out _));
        Assert.Equal("First", (await SnapshotAsync(_factory, kb)).Name);
    }

    [Fact]
    public async Task Update_WithStaleRowVersion_UnchangedBody_Returns412()
    {
        // The body equals the current state, so EF would send no UPDATE: the stale precondition must still be rejected.
        var owner = await CreateUserAsync(_factory, "owner");
        var (kb, stale) = await CreateKbAsync(_client, owner.Token);
        var first = await SendAsync(_client, HttpMethod.Put, $"{Root}/{kb}", owner.Token, new { name = "First", description = "d" }, Quote(stale));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var current = await RowVersionAsync(_client, owner.Token, kb);

        var second = await SendAsync(_client, HttpMethod.Put, $"{Root}/{kb}", owner.Token, new { name = "First", description = "d" }, Quote(stale));

        Assert.Equal(HttpStatusCode.PreconditionFailed, second.StatusCode);
        Assert.Equal(current, await RowVersionAsync(_client, owner.Token, kb));
    }

    [Fact]
    public async Task Update_WithoutIfMatch_Returns428()
    {
        var owner = await CreateUserAsync(_factory, "owner");
        var (kb, _) = await CreateKbAsync(_client, owner.Token);

        var response = await SendAsync(_client, HttpMethod.Put, $"{Root}/{kb}", owner.Token, new { name = "No precondition" });

        Assert.Equal((HttpStatusCode)428, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var body = await JsonAsync(response);
        Assert.Equal(428, body.GetProperty("status").GetInt32());
        Assert.True(body.TryGetProperty("correlationId", out _));
        Assert.Equal("Docs", (await SnapshotAsync(_factory, kb)).Name);
    }

    [Theory]
    [InlineData("*")]
    [InlineData("\"%%not-base64%%\"")]
    [InlineData("W/\"AAAAAAAAB9E=\"")]
    [InlineData("\"a\", \"b\"")]
    public async Task Update_WithUnusableIfMatch_Returns400(string ifMatch)
    {
        var owner = await CreateUserAsync(_factory, "owner");
        var (kb, _) = await CreateKbAsync(_client, owner.Token);

        var response = await SendAsync(_client, HttpMethod.Put, $"{Root}/{kb}", owner.Token, new { name = "X" }, ifMatch);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("Docs", (await SnapshotAsync(_factory, kb)).Name);
    }

    [Fact]
    public async Task RemoveLastOwner_Returns409()
    {
        var owner = await CreateUserAsync(_factory, "owner");
        var second = await CreateUserAsync(_factory, "second");
        var (kb, _) = await CreateKbAsync(_client, owner.Token);

        var remove = await SendAsync(_client, HttpMethod.Delete, $"{Root}/{kb}/members/{owner.Id}", owner.Token);
        Assert.Equal(HttpStatusCode.Conflict, remove.StatusCode);
        var demote = await SendAsync(_client, HttpMethod.Put, $"{Root}/{kb}/members/{owner.Id}", owner.Token, new { role = "Editor" });
        Assert.Equal(HttpStatusCode.Conflict, demote.StatusCode);
        Assert.Equal(1, await PermissionVersionAsync(_factory, kb));

        // With a second owner, the first one can leave.
        await AddMemberAsync(_client, owner.Token, kb, second.Id, KnowledgeBaseRole.Owner);
        var leave = await SendAsync(_client, HttpMethod.Delete, $"{Root}/{kb}/members/{owner.Id}", owner.Token);
        Assert.Equal(HttpStatusCode.NoContent, leave.StatusCode);

        // Now the second owner is the last one again.
        var removeLast = await SendAsync(_client, HttpMethod.Delete, $"{Root}/{kb}/members/{second.Id}", second.Token);
        Assert.Equal(HttpStatusCode.Conflict, removeLast.StatusCode);
        Assert.Equal($"{second.Id}:Owner", (await SnapshotAsync(_factory, kb)).Members);
    }

    [Fact]
    public async Task RemovedMember_LosesAccessImmediately()
    {
        var owner = await CreateUserAsync(_factory, "owner");
        var viewer = await CreateUserAsync(_factory, "viewer");
        var (kb, _) = await CreateKbAsync(_client, owner.Token);
        await AddMemberAsync(_client, owner.Token, kb, viewer.Id, KnowledgeBaseRole.Viewer);
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(_client, HttpMethod.Get, $"{Root}/{kb}", viewer.Token)).StatusCode);

        var remove = await SendAsync(_client, HttpMethod.Delete, $"{Root}/{kb}/members/{viewer.Id}", owner.Token);
        Assert.Equal(HttpStatusCode.NoContent, remove.StatusCode);

        // Same access token, next request.
        Assert.Equal(HttpStatusCode.NotFound, (await SendAsync(_client, HttpMethod.Get, $"{Root}/{kb}", viewer.Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await SendAsync(_client, HttpMethod.Get, $"{Root}/{kb}/members", viewer.Token)).StatusCode);
        var list = await JsonAsync(await SendAsync(_client, HttpMethod.Get, Root, viewer.Token));
        Assert.DoesNotContain(list.GetProperty("items").EnumerateArray(), e => e.GetProperty("id").GetGuid() == kb);
    }

    [Fact]
    public async Task Delete_SoftDeletes_AndSubsequentGetIs404()
    {
        var owner = await CreateUserAsync(_factory, "owner");
        var viewer = await CreateUserAsync(_factory, "viewer");
        var (kb, _) = await CreateKbAsync(_client, owner.Token);
        await AddMemberAsync(_client, owner.Token, kb, viewer.Id, KnowledgeBaseRole.Viewer);

        var delete = await SendAsync(_client, HttpMethod.Delete, $"{Root}/{kb}", owner.Token);
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);

        foreach (var token in new[] { owner.Token, viewer.Token })
        {
            Assert.Equal(HttpStatusCode.NotFound, (await SendAsync(_client, HttpMethod.Get, $"{Root}/{kb}", token)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await SendAsync(_client, HttpMethod.Get, $"{Root}/{kb}/members", token)).StatusCode);
            var list = await JsonAsync(await SendAsync(_client, HttpMethod.Get, Root, token));
            Assert.DoesNotContain(list.GetProperty("items").EnumerateArray(), e => e.GetProperty("id").GetGuid() == kb);
        }

        Assert.Equal(HttpStatusCode.NotFound, (await SendAsync(_client, HttpMethod.Delete, $"{Root}/{kb}", owner.Token)).StatusCode);
        var snapshot = await SnapshotAsync(_factory, kb);
        Assert.True(snapshot.IsDeleted);
        Assert.Equal("Docs", snapshot.Name);
        var deletedAt = await ApiDatabaseFixture.WithDbAsync(_factory, ctx =>
            ctx.KnowledgeBases.IgnoreQueryFilters().Where(k => k.Id == kb).Select(k => k.DeletedAt).SingleAsync());
        Assert.NotNull(deletedAt);
    }

    [Fact]
    public async Task AuditLog_ContainsKbCreateAndMemberChanges()
    {
        var owner = await CreateUserAsync(_factory, "owner");
        var member = await CreateUserAsync(_factory, "member");
        var (kb, rowVersion) = await CreateKbAsync(_client, owner.Token);
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(_client, HttpMethod.Put, $"{Root}/{kb}", owner.Token,
            new { name = "Renamed" }, Quote(rowVersion))).StatusCode);
        await AddMemberAsync(_client, owner.Token, kb, member.Id, KnowledgeBaseRole.Viewer);
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(_client, HttpMethod.Put, $"{Root}/{kb}/members/{member.Id}", owner.Token,
            new { role = "Editor" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await SendAsync(_client, HttpMethod.Delete, $"{Root}/{kb}/members/{member.Id}", owner.Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await SendAsync(_client, HttpMethod.Delete, $"{Root}/{kb}", owner.Token)).StatusCode);

        var entries = await ApiDatabaseFixture.WithDbAsync(_factory, ctx => ctx.AuditLogs.AsNoTracking()
            .Where(a => a.TargetId == kb.ToString())
            .OrderBy(a => a.OccurredAt).ThenBy(a => a.Id)
            .ToListAsync());

        Assert.Equal(
            [
                AuditActions.KnowledgeBaseCreated, AuditActions.KnowledgeBaseUpdated, AuditActions.MemberAdded,
                AuditActions.MemberRoleChanged, AuditActions.MemberRemoved, AuditActions.KnowledgeBaseDeleted,
            ],
            entries.Select(e => e.Action).ToArray());
        Assert.All(entries, e =>
        {
            Assert.Equal(owner.Id.ToString(), e.ActorId, ignoreCase: true);
            Assert.Equal(AuditTargets.KnowledgeBase, e.TargetType);
            var details = e.DetailsJson ?? string.Empty;
            Assert.DoesNotContain("password", details, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("token", details, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("hash", details, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(owner.Token, details, StringComparison.Ordinal);
        });
        Assert.Contains(member.Id.ToString(), entries[2].DetailsJson!, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Editor", entries[3].DetailsJson!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task GlobalAdmin_NonMember_Gets404()
    {
        var owner = await CreateUserAsync(_factory, "owner");
        var member = await CreateUserAsync(_factory, "member");
        var candidate = await CreateUserAsync(_factory, "candidate");
        var admin = await CreateUserAsync(_factory, "admin", Domain.Identity.GlobalRole.Admin);
        var (kb, _) = await CreateKbAsync(_client, owner.Token);
        await AddMemberAsync(_client, owner.Token, kb, member.Id, KnowledgeBaseRole.Viewer);
        var rowVersion = await RowVersionAsync(_client, owner.Token, kb);
        var before = await SnapshotAsync(_factory, kb);

        var seededAdmin = await ApiDatabaseFixture.AdminTokenAsync(_client);
        foreach (var token in new[] { admin.Token, seededAdmin })
        {
            foreach (var (method, url, body, ifMatch) in KbScopedRoutes(kb, member.Id, candidate.Id, rowVersion))
            {
                var response = await SendAsync(_client, method, url, token, body, ifMatch);
                Assert.True(response.StatusCode == HttpStatusCode.NotFound, $"{method} {url} -> {response.StatusCode}");
            }

            var list = await JsonAsync(await SendAsync(_client, HttpMethod.Get, Root, token));
            Assert.DoesNotContain(list.GetProperty("items").EnumerateArray(), e => e.GetProperty("id").GetGuid() == kb);
        }

        Assert.Equal(before, await SnapshotAsync(_factory, kb));
    }

    [Fact]
    public async Task AddMember_UnknownOrInactiveUser_Returns404or400()
    {
        var owner = await CreateUserAsync(_factory, "owner");
        var inactive = await CreateUserAsync(_factory, "inactive");
        await ApiDatabaseFixture.WithDbAsync(_factory, async ctx =>
        {
            (await ctx.Users.SingleAsync(u => u.Id == inactive.Id)).Deactivate();
            return await ctx.SaveChangesAsync();
        });
        var (kb, _) = await CreateKbAsync(_client, owner.Token);
        var before = await SnapshotAsync(_factory, kb);

        var unknown = await SendAsync(_client, HttpMethod.Post, $"{Root}/{kb}/members", owner.Token, new { userId = Guid.NewGuid(), role = "Viewer" });
        var deactivated = await SendAsync(_client, HttpMethod.Post, $"{Root}/{kb}/members", owner.Token, new { userId = inactive.Id, role = "Viewer" });
        var empty = await SendAsync(_client, HttpMethod.Post, $"{Root}/{kb}/members", owner.Token, new { userId = Guid.Empty, role = "Viewer" });
        var badRole = await SendAsync(_client, HttpMethod.Post, $"{Root}/{kb}/members", owner.Token, new { userId = inactive.Id, role = 42 });

        // Unknown and inactive users are indistinguishable: the same generic 404.
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, deactivated.StatusCode);
        var unknownBody = await JsonAsync(unknown);
        Assert.Equal(NormalizeProblem(unknownBody), NormalizeProblem(await JsonAsync(deactivated)));
        Assert.Equal("User not found.", unknownBody.GetProperty("detail").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, badRole.StatusCode);
        Assert.Equal(before, await SnapshotAsync(_factory, kb));
    }

    [Fact]
    public async Task AddMember_AlreadyMember_Returns409()
    {
        var owner = await CreateUserAsync(_factory, "owner");
        var member = await CreateUserAsync(_factory, "member");
        var (kb, _) = await CreateKbAsync(_client, owner.Token);
        await AddMemberAsync(_client, owner.Token, kb, member.Id, KnowledgeBaseRole.Viewer);

        var again = await SendAsync(_client, HttpMethod.Post, $"{Root}/{kb}/members", owner.Token, new { userId = member.Id, role = "Editor" });

        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
    }

    [Fact]
    public async Task ListMembers_ReturnsNameEmailRole_ForAnyMember()
    {
        var owner = await CreateUserAsync(_factory, "owner");
        var viewer = await CreateUserAsync(_factory, "viewer");
        var (kb, _) = await CreateKbAsync(_client, owner.Token);
        await AddMemberAsync(_client, owner.Token, kb, viewer.Id, KnowledgeBaseRole.Viewer);

        var response = await SendAsync(_client, HttpMethod.Get, $"{Root}/{kb}/members", viewer.Token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var items = (await JsonAsync(response)).EnumerateArray().ToList();
        Assert.Equal([owner.Id, viewer.Id], items.Select(i => i.GetProperty("userId").GetGuid()).ToArray());
        Assert.Equal(["Owner", "Viewer"], items.Select(i => i.GetProperty("role").GetString()!).ToArray());
        Assert.Equal(viewer.Email, items[1].GetProperty("email").GetString());
        Assert.Equal(
            ["displayName", "email", "role", "userId"],
            items[0].EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public async Task ChangeMemberRole_SameRole_IsNoOp()
    {
        var owner = await CreateUserAsync(_factory, "owner");
        var member = await CreateUserAsync(_factory, "member");
        var (kb, _) = await CreateKbAsync(_client, owner.Token);
        await AddMemberAsync(_client, owner.Token, kb, member.Id, KnowledgeBaseRole.Editor);
        var version = await PermissionVersionAsync(_factory, kb);
        var rowVersion = await RowVersionAsync(_client, owner.Token, kb);

        var response = await SendAsync(_client, HttpMethod.Put, $"{Root}/{kb}/members/{member.Id}", owner.Token, new { role = "Editor" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Editor", (await JsonAsync(response)).GetProperty("role").GetString());
        Assert.Equal(version, await PermissionVersionAsync(_factory, kb));
        Assert.Equal(rowVersion, await RowVersionAsync(_client, owner.Token, kb));
    }

    [Fact]
    public async Task PermissionVersion_IncrementsOnMembershipChange()
    {
        var owner = await CreateUserAsync(_factory, "owner");
        var member = await CreateUserAsync(_factory, "member");
        var (kb, rowVersion) = await CreateKbAsync(_client, owner.Token);
        Assert.Equal(1, await PermissionVersionAsync(_factory, kb));

        await AddMemberAsync(_client, owner.Token, kb, member.Id, KnowledgeBaseRole.Viewer);
        Assert.Equal(2, await PermissionVersionAsync(_factory, kb));

        Assert.Equal(HttpStatusCode.OK, (await SendAsync(_client, HttpMethod.Put, $"{Root}/{kb}/members/{member.Id}", owner.Token,
            new { role = "Owner" })).StatusCode);
        Assert.Equal(3, await PermissionVersionAsync(_factory, kb));

        Assert.Equal(HttpStatusCode.NoContent, (await SendAsync(_client, HttpMethod.Delete, $"{Root}/{kb}/members/{member.Id}", owner.Token)).StatusCode);
        Assert.Equal(4, await PermissionVersionAsync(_factory, kb));

        // Renaming is not a membership change.
        var current = await RowVersionAsync(_client, owner.Token, kb);
        Assert.NotEqual(rowVersion, current);
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(_client, HttpMethod.Put, $"{Root}/{kb}", owner.Token,
            new { name = "Renamed" }, Quote(current))).StatusCode);
        Assert.Equal(4, await PermissionVersionAsync(_factory, kb));
    }

    [Fact]
    public async Task UnknownMember_OnOwnKb_Returns404()
    {
        var owner = await CreateUserAsync(_factory, "owner");
        var (kb, _) = await CreateKbAsync(_client, owner.Token);

        var change = await SendAsync(_client, HttpMethod.Put, $"{Root}/{kb}/members/{Guid.NewGuid()}", owner.Token, new { role = "Viewer" });
        var remove = await SendAsync(_client, HttpMethod.Delete, $"{Root}/{kb}/members/{Guid.NewGuid()}", owner.Token);

        Assert.Equal(HttpStatusCode.NotFound, change.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, remove.StatusCode);
    }
}
