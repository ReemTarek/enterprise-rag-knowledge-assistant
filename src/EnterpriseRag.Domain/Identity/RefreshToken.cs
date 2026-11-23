using EnterpriseRag.Domain.Common;

namespace EnterpriseRag.Domain.Identity;

public class RefreshToken : Entity
{
    public Guid UserId { get; set; }

    public string TokenHash { get; set; } = string.Empty;

    public Guid FamilyId { get; set; }

    public DateTime ExpiresAt { get; set; }

    public DateTime? RevokedAt { get; set; }

    public string? ReplacedByTokenHash { get; set; }

    public bool IsActive(DateTime utcNow) => RevokedAt is null && ExpiresAt > utcNow;
}
