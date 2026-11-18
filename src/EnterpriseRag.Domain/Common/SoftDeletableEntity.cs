namespace EnterpriseRag.Domain.Common;

public abstract class SoftDeletableEntity : AuditableEntity
{
    public bool IsDeleted { get; private set; }

    public DateTime? DeletedAt { get; private set; }

    public void MarkDeleted(DateTime utcNow)
    {
        if (IsDeleted)
        {
            throw new DomainException("Entity is already deleted.");
        }

        if (utcNow.Kind != DateTimeKind.Utc)
        {
            throw new DomainException("Deletion timestamp must be in UTC.");
        }

        IsDeleted = true;
        DeletedAt = utcNow;
    }
}
