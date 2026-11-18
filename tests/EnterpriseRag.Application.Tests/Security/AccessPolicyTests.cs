using EnterpriseRag.Application.Security;
using EnterpriseRag.Application.Tests.Fakes;
using EnterpriseRag.Domain.Identity;
using EnterpriseRag.Domain.KnowledgeBases;

namespace EnterpriseRag.Application.Tests.Security;

public class AccessPolicyTests
{
    private readonly TestHarness _h = new();

    [Fact]
    public async Task AccessPolicy_NonMember_ThrowsNotFound()
    {
        var owner = _h.AddUser("owner@example.com");
        var kb = _h.AddKnowledgeBase("Docs", owner.Id);
        _h.SignInAs(_h.AddUser("stranger@example.com"));

        var nonMember = await Assert.ThrowsAsync<NotFoundException>(() =>
            _h.Policy.RequireKnowledgeBaseAsync(kb.Id, KnowledgeBaseRole.Viewer, CancellationToken.None));
        var missing = await Assert.ThrowsAsync<NotFoundException>(() =>
            _h.Policy.RequireKnowledgeBaseAsync(Guid.NewGuid(), KnowledgeBaseRole.Viewer, CancellationToken.None));

        Assert.Equal(missing.Message, nonMember.Message);
        Assert.Equal("Knowledge base not found.", nonMember.Message);
    }

    [Fact]
    public async Task AccessPolicy_SoftDeletedKb_ThrowsNotFound_EvenForOwner()
    {
        var owner = _h.AddUser("owner@example.com");
        var kb = _h.AddKnowledgeBase("Docs", owner.Id);
        kb.MarkDeleted(_h.Clock.UtcNow);
        _h.SignInAs(owner);

        var ex = await Assert.ThrowsAsync<NotFoundException>(() =>
            _h.Policy.RequireKnowledgeBaseAsync(kb.Id, KnowledgeBaseRole.Viewer, CancellationToken.None));
        Assert.Equal("Knowledge base not found.", ex.Message);
    }

    [Fact]
    public async Task AccessPolicy_ViewerRequestingOwner_ThrowsAccessDenied()
    {
        var owner = _h.AddUser("owner@example.com");
        var viewer = _h.AddUser("viewer@example.com");
        var kb = _h.AddKnowledgeBase("Docs", owner.Id);
        kb.AddMember(viewer.Id, KnowledgeBaseRole.Viewer);
        _h.SignInAs(viewer);

        await Assert.ThrowsAsync<AccessDeniedException>(() =>
            _h.Policy.RequireKnowledgeBaseAsync(kb.Id, KnowledgeBaseRole.Owner, CancellationToken.None));
        await Assert.ThrowsAsync<AccessDeniedException>(() =>
            _h.Policy.RequireKnowledgeBaseAsync(kb.Id, KnowledgeBaseRole.Editor, CancellationToken.None));
        var allowed = await _h.Policy.RequireKnowledgeBaseAsync(kb.Id, KnowledgeBaseRole.Viewer, CancellationToken.None);
        Assert.Same(kb, allowed);
    }

    [Fact]
    public async Task AccessPolicy_GlobalAdminNonMember_ThrowsNotFound()
    {
        var owner = _h.AddUser("owner@example.com");
        var kb = _h.AddKnowledgeBase("Docs", owner.Id);
        _h.SignInAs(_h.AddUser("admin@example.com", role: GlobalRole.Admin));
        Assert.True(_h.CurrentUser.IsAdmin);

        await Assert.ThrowsAsync<NotFoundException>(() =>
            _h.Policy.RequireKnowledgeBaseAsync(kb.Id, KnowledgeBaseRole.Viewer, CancellationToken.None));
        Assert.Empty(await _h.Policy.AccessibleKnowledgeBaseIdsAsync(CancellationToken.None));
    }

    [Fact]
    public async Task AccessPolicy_AccessibleIds_AreCallersNonDeletedMemberships()
    {
        var me = _h.AddUser("me@example.com");
        var other = _h.AddUser("other@example.com");
        var mine = _h.AddKnowledgeBase("Mine", me.Id);
        var shared = _h.AddKnowledgeBase("Shared", other.Id);
        shared.AddMember(me.Id, KnowledgeBaseRole.Viewer);
        _h.AddKnowledgeBase("Theirs", other.Id);
        var deleted = _h.AddKnowledgeBase("Deleted", me.Id);
        deleted.MarkDeleted(_h.Clock.UtcNow);
        _h.SignInAs(me);

        var ids = await _h.Policy.AccessibleKnowledgeBaseIdsAsync(CancellationToken.None);

        Assert.Equal(new[] { mine.Id, shared.Id }.Order(), ids.Order());
    }

    [Fact]
    public async Task AccessPolicy_Unauthenticated_IsDenied()
    {
        var owner = _h.AddUser("owner@example.com");
        var kb = _h.AddKnowledgeBase("Docs", owner.Id);

        await Assert.ThrowsAsync<AccessDeniedException>(() =>
            _h.Policy.RequireKnowledgeBaseAsync(kb.Id, KnowledgeBaseRole.Viewer, CancellationToken.None));
    }
}
