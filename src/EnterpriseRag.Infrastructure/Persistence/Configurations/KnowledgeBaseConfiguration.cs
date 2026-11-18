using EnterpriseRag.Domain.KnowledgeBases;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EnterpriseRag.Infrastructure.Persistence.Configurations;

public sealed class KnowledgeBaseConfiguration : IEntityTypeConfiguration<KnowledgeBase>
{
    public const int MaxDescriptionLength = 2000;

    public void Configure(EntityTypeBuilder<KnowledgeBase> builder)
    {
        builder.ToTable("KnowledgeBases");
        builder.HasKey(k => k.Id);
        builder.Property(k => k.Name).IsRequired().HasMaxLength(KnowledgeBase.MaxNameLength);
        builder.Property(k => k.Description).HasMaxLength(MaxDescriptionLength);
        builder.Property(k => k.RowVersion).IsRowVersion();
        builder.Property(k => k.CreatedBy).HasMaxLength(200);
        builder.Property(k => k.UpdatedBy).HasMaxLength(200);

        // Members are part of the aggregate and are written through the private _members field.
        builder.HasMany(k => k.Members).WithOne().HasForeignKey(m => m.KnowledgeBaseId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(k => k.Members).HasField("_members").UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}
