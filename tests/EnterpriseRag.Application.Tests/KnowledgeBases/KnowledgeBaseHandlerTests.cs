using EnterpriseRag.Application.KnowledgeBases;
using EnterpriseRag.Application.Security;
using EnterpriseRag.Application.Tests.Fakes;
using EnterpriseRag.Domain.Identity;
using EnterpriseRag.Domain.KnowledgeBases;
using FluentValidation;

namespace EnterpriseRag.Application.Tests.KnowledgeBases;

public class KnowledgeBaseHandlerTests
{
    private readonly TestHarness _h = new();

    private (User Owner, User Editor, User Viewer, KnowledgeBase Kb) Seed()
    {
        var owner = _h.AddUser("owner@example.com", "Owner");
        var editor = _h.AddUser("editor@example.com", "Editor");
        var viewer = _h.AddUser("viewer@example.com", "Viewer");
        var kb = _h.AddKnowledgeBase("Docs", owner.Id);
        kb.AddMember(editor.Id, KnowledgeBaseRole.Editor);
        kb.AddMember(viewer.Id, KnowledgeBaseRole.Viewer);
        return (owner, editor, viewer, kb);
    }

    [Fact]
    public async Task CreateKnowledgeBase_MakesCallerOwner()
    {
        var me = _h.AddUser("me@example.com");
        _h.SignInAs(me);

        var dto = await _h.CreateKnowledgeBase().HandleAsync(new CreateKnowledgeBaseCommand("  Handbook ", "HR docs"), CancellationToken.None);

        Assert.Equal("Handbook", dto.Name);
        Assert.Equal(KnowledgeBaseRole.Owner, dto.MyRole);
        var kb = _h.Db.KnowledgeBases.Single();
        Assert.Equal(KnowledgeBaseRole.Owner, kb.RoleOf(me.Id));
        Assert.Equal(1, _h.Db.SaveCount);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task CreateKnowledgeBase_InvalidName_FailsValidation(string name)
    {
        _h.SignInAs(_h.AddUser("me@example.com"));

        await Assert.ThrowsAsync<ValidationException>(() =>
            _h.CreateKnowledgeBase().HandleAsync(new CreateKnowledgeBaseCommand(name, null), CancellationToken.None));
        await Assert.ThrowsAsync<ValidationException>(() =>
            _h.CreateKnowledgeBase().HandleAsync(new CreateKnowledgeBaseCommand(new string('x', 201), null), CancellationToken.None));
    }

    [Fact]
    public async Task ListKnowledgeBases_ReturnsOnlyCallersMemberships()
    {
        var me = _h.AddUser("me@example.com");
        var other = _h.AddUser("other@example.com");
        _h.AddKnowledgeBase("B mine", me.Id);
        var shared = _h.AddKnowledgeBase("A shared", other.Id);
        shared.AddMember(me.Id, KnowledgeBaseRole.Viewer);
        _h.AddKnowledgeBase("C theirs", other.Id);
        _h.AddKnowledgeBase("D deleted", me.Id).MarkDeleted(_h.Clock.UtcNow);
        _h.SignInAs(me);

        var page = await _h.ListKnowledgeBases().HandleAsync(new ListKnowledgeBasesQuery(1, 20), CancellationToken.None);

        Assert.Equal(2, page.TotalCount);
        Assert.Equal(["A shared", "B mine"], page.Items.Select(i => i.Name));
        Assert.Equal(KnowledgeBaseRole.Viewer, page.Items[0].MyRole);
        Assert.Equal(KnowledgeBaseRole.Owner, page.Items[1].MyRole);
    }

    [Fact]
    public async Task GetKnowledgeBase_ReturnsDto_WithBase64RowVersion()
    {
        var (_, _, viewer, kb) = Seed();
        kb.RowVersion = [1, 2, 3, 4, 5, 6, 7, 8];
        _h.SignInAs(viewer);

        var dto = await _h.GetKnowledgeBase().HandleAsync(new GetKnowledgeBaseQuery(kb.Id), CancellationToken.None);

        Assert.Equal(Convert.ToBase64String(kb.RowVersion), dto.RowVersion);
        Assert.Equal(KnowledgeBaseRole.Viewer, dto.MyRole);
    }

    [Fact]
    public async Task UpdateKnowledgeBase_ByOwner_Renames_AndByEditor_IsDenied()
    {
        var (owner, editor, _, kb) = Seed();
        kb.RowVersion = [9, 9, 9, 9, 9, 9, 9, 9];

        _h.SignInAs(editor);
        await Assert.ThrowsAsync<AccessDeniedException>(() =>
            _h.UpdateKnowledgeBase().HandleAsync(new UpdateKnowledgeBaseCommand(kb.Id, "New", null, null), CancellationToken.None));

        _h.SignInAs(owner);
        var dto = await _h.UpdateKnowledgeBase().HandleAsync(
            new UpdateKnowledgeBaseCommand(kb.Id, "New", "desc", Convert.ToBase64String(kb.RowVersion)), CancellationToken.None);

        Assert.Equal("New", dto.Name);
        Assert.Equal("desc", kb.Description);
        Assert.Contains(_h.Audit.Entries, e => e.Action == AuditActions.KnowledgeBaseUpdated);
    }

    [Fact]
    public async Task UpdateKnowledgeBase_StaleRowVersion_IsConflict()
    {
        var (owner, _, _, kb) = Seed();
        kb.RowVersion = [9, 9, 9, 9, 9, 9, 9, 9];
        _h.SignInAs(owner);

        await Assert.ThrowsAsync<ConflictException>(() => _h.UpdateKnowledgeBase().HandleAsync(
            new UpdateKnowledgeBaseCommand(kb.Id, "New", null, Convert.ToBase64String(new byte[] { 1, 1, 1, 1, 1, 1, 1, 1 })),
            CancellationToken.None));
        Assert.Equal("Docs", kb.Name);
        await Assert.ThrowsAsync<ValidationException>(() => _h.UpdateKnowledgeBase().HandleAsync(
            new UpdateKnowledgeBaseCommand(kb.Id, "New", null, "%%not-base64%%"), CancellationToken.None));
    }

    [Fact]
    public async Task DeleteKnowledgeBase_SoftDeletes_ThenGetIsNotFound()
    {
        var (owner, editor, _, kb) = Seed();

        _h.SignInAs(editor);
        await Assert.ThrowsAsync<AccessDeniedException>(() =>
            _h.DeleteKnowledgeBase().HandleAsync(new DeleteKnowledgeBaseCommand(kb.Id), CancellationToken.None));

        _h.SignInAs(owner);
        await _h.DeleteKnowledgeBase().HandleAsync(new DeleteKnowledgeBaseCommand(kb.Id), CancellationToken.None);

        Assert.True(kb.IsDeleted);
        Assert.Equal(_h.Clock.UtcNow, kb.DeletedAt);
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _h.GetKnowledgeBase().HandleAsync(new GetKnowledgeBaseQuery(kb.Id), CancellationToken.None));
        Assert.Contains(_h.Audit.Entries, e => e.Action == AuditActions.KnowledgeBaseDeleted);
    }

    [Fact]
    public async Task AddMember_ValidatesTarget_AndRejectsDuplicates()
    {
        var (owner, editor, _, kb) = Seed();
        var newcomer = _h.AddUser("new@example.com", "Newcomer");
        var inactive = _h.AddUser("gone@example.com", active: false);
        _h.SignInAs(owner);

        await Assert.ThrowsAsync<NotFoundException>(() =>
            _h.AddMember().HandleAsync(new AddMemberCommand(kb.Id, Guid.NewGuid(), KnowledgeBaseRole.Viewer), CancellationToken.None));
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _h.AddMember().HandleAsync(new AddMemberCommand(kb.Id, inactive.Id, KnowledgeBaseRole.Viewer), CancellationToken.None));
        await Assert.ThrowsAsync<ConflictException>(() =>
            _h.AddMember().HandleAsync(new AddMemberCommand(kb.Id, editor.Id, KnowledgeBaseRole.Viewer), CancellationToken.None));
        await Assert.ThrowsAsync<ValidationException>(() =>
            _h.AddMember().HandleAsync(new AddMemberCommand(kb.Id, newcomer.Id, (KnowledgeBaseRole)42), CancellationToken.None));

        var version = kb.PermissionVersion;
        var dto = await _h.AddMember().HandleAsync(new AddMemberCommand(kb.Id, newcomer.Id, KnowledgeBaseRole.Editor), CancellationToken.None);

        Assert.Equal(newcomer.Id, dto.UserId);
        Assert.Equal("Newcomer", dto.DisplayName);
        Assert.Equal(KnowledgeBaseRole.Editor, kb.RoleOf(newcomer.Id));
        Assert.Equal(version + 1, kb.PermissionVersion);
    }

    [Fact]
    public async Task AddMember_ByEditor_IsDenied()
    {
        var (_, editor, _, kb) = Seed();
        var newcomer = _h.AddUser("new@example.com");
        _h.SignInAs(editor);

        await Assert.ThrowsAsync<AccessDeniedException>(() =>
            _h.AddMember().HandleAsync(new AddMemberCommand(kb.Id, newcomer.Id, KnowledgeBaseRole.Viewer), CancellationToken.None));
    }

    [Fact]
    public async Task RemoveMember_LastOwner_Fails()
    {
        var (owner, _, _, kb) = Seed();
        _h.SignInAs(owner);
        var version = kb.PermissionVersion;

        await Assert.ThrowsAsync<ConflictException>(() =>
            _h.RemoveMember().HandleAsync(new RemoveMemberCommand(kb.Id, owner.Id), CancellationToken.None));

        Assert.Equal(KnowledgeBaseRole.Owner, kb.RoleOf(owner.Id));
        Assert.Equal(version, kb.PermissionVersion);
        Assert.Empty(_h.Audit.Entries);
    }

    [Fact]
    public async Task RemoveMember_ByEditor_IsDenied()
    {
        var (_, editor, viewer, kb) = Seed();
        _h.SignInAs(editor);

        await Assert.ThrowsAsync<AccessDeniedException>(() =>
            _h.RemoveMember().HandleAsync(new RemoveMemberCommand(kb.Id, viewer.Id), CancellationToken.None));

        Assert.Equal(KnowledgeBaseRole.Viewer, kb.RoleOf(viewer.Id));
    }

    [Fact]
    public async Task RemoveMember_ByOwner_RemovesAccessImmediately()
    {
        var (owner, _, viewer, kb) = Seed();
        _h.SignInAs(owner);

        await _h.RemoveMember().HandleAsync(new RemoveMemberCommand(kb.Id, viewer.Id), CancellationToken.None);

        _h.SignInAs(viewer);
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _h.GetKnowledgeBase().HandleAsync(new GetKnowledgeBaseQuery(kb.Id), CancellationToken.None));

        _h.SignInAs(owner);
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _h.RemoveMember().HandleAsync(new RemoveMemberCommand(kb.Id, viewer.Id), CancellationToken.None));
    }

    [Fact]
    public async Task ChangeMemberRole_IncrementsPermissionVersion()
    {
        var (owner, _, viewer, kb) = Seed();
        _h.SignInAs(owner);
        var version = kb.PermissionVersion;

        var dto = await _h.ChangeMemberRole().HandleAsync(new ChangeMemberRoleCommand(kb.Id, viewer.Id, KnowledgeBaseRole.Editor), CancellationToken.None);

        Assert.Equal(KnowledgeBaseRole.Editor, dto.Role);
        Assert.Equal(KnowledgeBaseRole.Editor, kb.RoleOf(viewer.Id));
        Assert.Equal(version + 1, kb.PermissionVersion);
        Assert.Contains(_h.Audit.Entries, e => e.Action == AuditActions.MemberRoleChanged);
    }

    /// <summary>Re-assigning the role a member already has changes nothing: no PermissionVersion bump, no audit entry.</summary>
    [Fact]
    public async Task ChangeMemberRole_SameRole_IsNoOp()
    {
        var (owner, _, viewer, kb) = Seed();
        _h.SignInAs(owner);
        var version = kb.PermissionVersion;

        var dto = await _h.ChangeMemberRole().HandleAsync(new ChangeMemberRoleCommand(kb.Id, viewer.Id, KnowledgeBaseRole.Viewer), CancellationToken.None);

        Assert.Equal(KnowledgeBaseRole.Viewer, dto.Role);
        Assert.Equal(version, kb.PermissionVersion);
        Assert.Empty(_h.Audit.Entries);
    }

    [Fact]
    public async Task ChangeMemberRole_DemotingLastOwner_IsConflict()
    {
        var (owner, _, _, kb) = Seed();
        _h.SignInAs(owner);

        await Assert.ThrowsAsync<ConflictException>(() =>
            _h.ChangeMemberRole().HandleAsync(new ChangeMemberRoleCommand(kb.Id, owner.Id, KnowledgeBaseRole.Editor), CancellationToken.None));
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _h.ChangeMemberRole().HandleAsync(new ChangeMemberRoleCommand(kb.Id, Guid.NewGuid(), KnowledgeBaseRole.Editor), CancellationToken.None));
    }

    [Fact]
    public async Task ListMembers_AnyMember_SeesNamesEmailsAndRoles()
    {
        var (_, _, viewer, kb) = Seed();
        var stranger = _h.AddUser("stranger@example.com");

        _h.SignInAs(viewer);
        var members = await _h.ListMembers().HandleAsync(new ListMembersQuery(kb.Id), CancellationToken.None);

        Assert.Equal(3, members.Count);
        Assert.Contains(members, m => m.Email == "owner@example.com" && m.Role == KnowledgeBaseRole.Owner);

        _h.SignInAs(stranger);
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _h.ListMembers().HandleAsync(new ListMembersQuery(kb.Id), CancellationToken.None));
    }
}
