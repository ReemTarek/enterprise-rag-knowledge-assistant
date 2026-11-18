using EnterpriseRag.Application.KnowledgeBases;
using EnterpriseRag.Application.Tests.Fakes;
using EnterpriseRag.Application.Users;
using EnterpriseRag.Domain.Identity;
using EnterpriseRag.Domain.KnowledgeBases;

namespace EnterpriseRag.Application.Tests;

public class AuditTests
{
    [Theory]
    [InlineData("create-user", AuditActions.UserCreated)]
    [InlineData("create-kb", AuditActions.KnowledgeBaseCreated)]
    [InlineData("add-member", AuditActions.MemberAdded)]
    [InlineData("remove-member", AuditActions.MemberRemoved)]
    public async Task StateChangingHandlers_WriteAuditLog(string operation, string expectedAction)
    {
        var h = new TestHarness();
        var admin = h.AddUser("admin@example.com", "Admin", role: GlobalRole.Admin);
        var member = h.AddUser("member@example.com", "Member");
        var kb = h.AddKnowledgeBase("Docs", admin.Id);
        if (operation == "remove-member")
        {
            kb.AddMember(member.Id, KnowledgeBaseRole.Viewer);
        }

        h.SignInAs(admin);
        string expectedTarget;
        switch (operation)
        {
            case "create-user":
                var created = await h.CreateUser().HandleAsync(new CreateUserCommand("x@example.com", "X", GlobalRole.User), CancellationToken.None);
                expectedTarget = created.Id.ToString();
                break;
            case "create-kb":
                var createdKb = await h.CreateKnowledgeBase().HandleAsync(new CreateKnowledgeBaseCommand("New KB", null), CancellationToken.None);
                expectedTarget = createdKb.Id.ToString();
                break;
            case "add-member":
                await h.AddMember().HandleAsync(new AddMemberCommand(kb.Id, member.Id, KnowledgeBaseRole.Editor), CancellationToken.None);
                expectedTarget = kb.Id.ToString();
                break;
            case "remove-member":
                await h.RemoveMember().HandleAsync(new RemoveMemberCommand(kb.Id, member.Id), CancellationToken.None);
                expectedTarget = kb.Id.ToString();
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(operation));
        }

        var entry = Assert.Single(h.Audit.Entries);
        Assert.Equal(expectedAction, entry.Action);
        Assert.Equal(expectedTarget, entry.TargetId);
        Assert.False(string.IsNullOrEmpty(entry.TargetType));
        Assert.DoesNotContain("hashed:", entry.DetailsJson ?? string.Empty);
        Assert.DoesNotContain("Temp-Pass", entry.DetailsJson ?? string.Empty);
    }
}
