using EnterpriseRag.Domain.Audit;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EnterpriseRag.Infrastructure.Persistence.Configurations;

public sealed class AuditLogConfiguration : IEntityTypeConfiguration<AuditLog>
{
    public void Configure(EntityTypeBuilder<AuditLog> builder)
    {
        builder.ToTable("AuditLogs");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Action).IsRequired().HasMaxLength(200);
        builder.Property(a => a.ActorId).HasMaxLength(200);
        builder.Property(a => a.TargetType).HasMaxLength(200);
        builder.Property(a => a.TargetId).HasMaxLength(200);
        builder.Property(a => a.DetailsJson);
        builder.HasIndex(a => a.OccurredAt);
    }
}
