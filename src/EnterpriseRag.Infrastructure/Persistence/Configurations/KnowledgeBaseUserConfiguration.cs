using EnterpriseRag.Domain.Identity;
using EnterpriseRag.Domain.KnowledgeBases;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EnterpriseRag.Infrastructure.Persistence.Configurations;

public sealed class KnowledgeBaseUserConfiguration : IEntityTypeConfiguration<KnowledgeBaseUser>
{
    public void Configure(EntityTypeBuilder<KnowledgeBaseUser> builder)
    {
        builder.ToTable("KnowledgeBaseUsers");

        // The composite primary key is the unique (KnowledgeBaseId, UserId) constraint: one membership per user.
        builder.HasKey(m => new { m.KnowledgeBaseId, m.UserId });
        builder.Property(m => m.Role).HasConversion<string>().HasMaxLength(32);

        // "Which knowledge bases can this user see" lookups start from the user.
        builder.HasIndex(m => new { m.UserId, m.KnowledgeBaseId });

        builder.HasOne<User>().WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Restrict);
    }
}
