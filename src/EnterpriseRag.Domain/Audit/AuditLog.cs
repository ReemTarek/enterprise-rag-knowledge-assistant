using EnterpriseRag.Domain.Common;

namespace EnterpriseRag.Domain.Audit;

/// <summary>Append-only audit record. Persistence rejects updates and deletes.</summary>
public class AuditLog : Entity
{
    public string Action { get; set; } = string.Empty;

    public string? ActorId { get; set; }

    public string? TargetType { get; set; }

    public string? TargetId { get; set; }

    public DateTime OccurredAt { get; set; }

    public string? DetailsJson { get; set; }
}
