namespace EnterpriseRag.Domain.Common;

public abstract class AuditableEntity : Entity
{
    public DateTime CreatedAt { get; set; }

    public DateTime? UpdatedAt { get; set; }

    public string? CreatedBy { get; set; }

    public string? UpdatedBy { get; set; }
}
