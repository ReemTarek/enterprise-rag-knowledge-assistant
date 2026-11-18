using EnterpriseRag.Domain.Common;
using EnterpriseRag.Domain.KnowledgeBases;

namespace EnterpriseRag.Domain.Tests.KnowledgeBases;

public class KnowledgeBaseTests
{
    [Fact]
    public void KnowledgeBase_Create_MakesCreatorOwner()
    {
        var owner = Guid.NewGuid();

        var kb = KnowledgeBase.Create("Docs", null, owner);

        Assert.Equal(KnowledgeBaseRole.Owner, kb.RoleOf(owner));
        Assert.Single(kb.Members);
    }

    [Fact]
    public void KnowledgeBase_RemoveLastOwner_Throws()
    {
        var owner = Guid.NewGuid();
        var kb = KnowledgeBase.Create("Docs", null, owner);

        Assert.Throws<DomainException>(() => kb.RemoveMember(owner));
    }

    [Fact]
    public void KnowledgeBase_DemoteLastOwner_Throws()
    {
        var owner = Guid.NewGuid();
        var kb = KnowledgeBase.Create("Docs", null, owner);

        Assert.Throws<DomainException>(() => kb.ChangeMemberRole(owner, KnowledgeBaseRole.Editor));
    }

    [Fact]
    public void KnowledgeBase_AddDuplicateMember_Throws()
    {
        var owner = Guid.NewGuid();
        var kb = KnowledgeBase.Create("Docs", null, owner);

        Assert.Throws<DomainException>(() => kb.AddMember(owner, KnowledgeBaseRole.Viewer));
    }

    [Fact]
    public void KnowledgeBase_MembershipChange_IncrementsPermissionVersion()
    {
        var owner = Guid.NewGuid();
        var other = Guid.NewGuid();
        var kb = KnowledgeBase.Create("Docs", null, owner);
        var v = kb.PermissionVersion;

        kb.AddMember(other, KnowledgeBaseRole.Viewer);
        Assert.Equal(v + 1, kb.PermissionVersion);

        kb.ChangeMemberRole(other, KnowledgeBaseRole.Editor);
        Assert.Equal(v + 2, kb.PermissionVersion);

        kb.RemoveMember(other);
        Assert.Equal(v + 3, kb.PermissionVersion);
        Assert.Null(kb.RoleOf(other));
    }

    [Fact]
    public void KnowledgeBase_Create_InvalidName_Throws()
    {
        Assert.Throws<DomainException>(() => KnowledgeBase.Create("", null, Guid.NewGuid()));
        Assert.Throws<DomainException>(() => KnowledgeBase.Create(new string('x', 201), null, Guid.NewGuid()));
    }
}
