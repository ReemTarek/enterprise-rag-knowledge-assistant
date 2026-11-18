using EnterpriseRag.Domain.Common;

namespace EnterpriseRag.Domain.KnowledgeBases;

public class KnowledgeBase : SoftDeletableEntity
{
    public const int MaxNameLength = 200;

    private readonly List<KnowledgeBaseUser> _members = [];

    private KnowledgeBase()
    {
    }

    public string Name { get; private set; } = string.Empty;

    public string? Description { get; private set; }

    /// <summary>Incremented on every membership change; starts at 1 on creation (creator is the first member).</summary>
    public int PermissionVersion { get; private set; }

    public byte[] RowVersion { get; set; } = [];

    public IReadOnlyCollection<KnowledgeBaseUser> Members => _members;

    public static KnowledgeBase Create(string name, string? description, Guid ownerId)
    {
        ValidateName(name);
        var kb = new KnowledgeBase { Name = name.Trim(), Description = description };
        kb._members.Add(new KnowledgeBaseUser { KnowledgeBaseId = kb.Id, UserId = ownerId, Role = KnowledgeBaseRole.Owner });
        kb.PermissionVersion = 1;
        return kb;
    }

    public void Rename(string name, string? description)
    {
        ValidateName(name);
        Name = name.Trim();
        Description = description;
    }

    public KnowledgeBaseUser AddMember(Guid userId, KnowledgeBaseRole role)
    {
        if (_members.Any(m => m.UserId == userId))
        {
            throw new DomainException("User is already a member of this knowledge base.");
        }

        var member = new KnowledgeBaseUser { KnowledgeBaseId = Id, UserId = userId, Role = role };
        _members.Add(member);
        PermissionVersion++;
        return member;
    }

    public void ChangeMemberRole(Guid userId, KnowledgeBaseRole role)
    {
        var member = Find(userId);
        if (member.Role == KnowledgeBaseRole.Owner && role != KnowledgeBaseRole.Owner)
        {
            EnsureAnotherOwner(userId);
        }

        member.Role = role;
        PermissionVersion++;
    }

    public void RemoveMember(Guid userId)
    {
        var member = Find(userId);
        if (member.Role == KnowledgeBaseRole.Owner)
        {
            EnsureAnotherOwner(userId);
        }

        _members.Remove(member);
        PermissionVersion++;
    }

    public KnowledgeBaseRole? RoleOf(Guid userId) => _members.FirstOrDefault(m => m.UserId == userId)?.Role;

    private static void ValidateName(string name)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > MaxNameLength)
        {
            throw new DomainException($"Name must be between 1 and {MaxNameLength} characters.");
        }
    }

    private KnowledgeBaseUser Find(Guid userId) =>
        _members.FirstOrDefault(m => m.UserId == userId)
        ?? throw new DomainException("User is not a member of this knowledge base.");

    private void EnsureAnotherOwner(Guid excludedUserId)
    {
        if (!_members.Any(m => m.UserId != excludedUserId && m.Role == KnowledgeBaseRole.Owner))
        {
            throw new DomainException("A knowledge base must keep at least one owner.");
        }
    }
}
