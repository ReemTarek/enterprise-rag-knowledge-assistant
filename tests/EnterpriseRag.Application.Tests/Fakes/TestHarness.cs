using EnterpriseRag.Application.Auth;
using EnterpriseRag.Application.KnowledgeBases;
using EnterpriseRag.Application.Security;
using EnterpriseRag.Application.Users;
using EnterpriseRag.Domain.Identity;
using EnterpriseRag.Domain.KnowledgeBases;
using EnterpriseRag.Shared.Options;

namespace EnterpriseRag.Application.Tests.Fakes;

/// <summary>Wires every handler against in-memory fakes; one instance per test.</summary>
public sealed class TestHarness
{
    public const string DefaultPassword = "Correct-Horse-42";

    public TestHarness()
    {
        Tokens = new FakeTokenService(Clock);
    }

    public FakeClock Clock { get; } = new(new DateTime(2026, 11, 18, 12, 0, 0, DateTimeKind.Utc));

    public InMemoryAppDbContext Db { get; } = new();

    public InMemoryQueryExecutor Query { get; } = new();

    public FakePasswordHasher Hasher { get; } = new();

    public FakeTokenService Tokens { get; }

    public FakeAuditLogger Audit { get; } = new();

    public FakeCurrentUser CurrentUser { get; } = new();

    public SecurityOptions Security { get; } = new();

    public AccessPolicy Policy => new(Db, Query, CurrentUser);

    public User AddUser(string email, string displayName = "Some User", string password = DefaultPassword,
        GlobalRole role = GlobalRole.User, bool active = true, bool mustChange = false)
    {
        var user = User.Create(email, displayName, Hasher.Hash(password), role, mustChange);
        if (!active)
        {
            user.Deactivate();
        }

        Db.Add(user);
        return user;
    }

    public void SignInAs(User user) => CurrentUser.Set(user.Id, user.GlobalRole == GlobalRole.Admin);

    public KnowledgeBase AddKnowledgeBase(string name, Guid ownerId)
    {
        var kb = KnowledgeBase.Create(name, null, ownerId);
        Db.Add(kb);
        return kb;
    }

    public LoginHandler Login() => new(Db, Query, Hasher, Tokens, Clock, Security, Audit);

    public RefreshHandler Refresh() => new(Db, Query, Tokens, Clock, Audit);

    public LogoutHandler Logout() => new(Db, Query, Tokens, Clock, Audit);

    public ChangePasswordHandler ChangePassword() => new(Db, Query, Hasher, CurrentUser, Security, Audit);

    public CreateUserHandler CreateUser() => new(Db, Query, Hasher, CurrentUser, Audit);

    public ListUsersHandler ListUsers() => new(Db, Query, CurrentUser);

    public DeactivateUserHandler DeactivateUser() => new(Db, Query, CurrentUser, Clock, Audit);

    public ResetPasswordHandler ResetPassword() => new(Db, Query, Hasher, CurrentUser, Clock, Audit);

    public SearchUserDirectoryHandler SearchDirectory() => new(Db, Query);

    public CreateKnowledgeBaseHandler CreateKnowledgeBase() => new(Db, CurrentUser, Audit);

    public ListKnowledgeBasesHandler ListKnowledgeBases() => new(Db, Query, CurrentUser);

    public GetKnowledgeBaseHandler GetKnowledgeBase() => new(Policy, CurrentUser);

    public UpdateKnowledgeBaseHandler UpdateKnowledgeBase() => new(Db, Policy, CurrentUser, Audit);

    public DeleteKnowledgeBaseHandler DeleteKnowledgeBase() => new(Db, Policy, Clock, Audit);

    public AddMemberHandler AddMember() => new(Db, Query, Policy, Audit);

    public ChangeMemberRoleHandler ChangeMemberRole() => new(Db, Query, Policy, Audit);

    public RemoveMemberHandler RemoveMember() => new(Db, Policy, Audit);

    public ListMembersHandler ListMembers() => new(Db, Query, Policy);
}
