using EnterpriseRag.Application.Users;
using EnterpriseRag.Domain.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EnterpriseRag.Infrastructure.Persistence.Configurations;

public sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public const string EmailIndexName = "IX_Users_Email";

    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("Users");
        builder.HasKey(u => u.Id);
        builder.Property(u => u.Email).IsRequired().HasMaxLength(CreateUserValidator.MaxEmailLength);
        builder.Property(u => u.DisplayName).IsRequired().HasMaxLength(CreateUserValidator.MaxDisplayNameLength);
        builder.Property(u => u.PasswordHash).IsRequired().HasMaxLength(512);
        builder.Property(u => u.GlobalRole).HasConversion<string>().HasMaxLength(32);
        builder.Property(u => u.CreatedBy).HasMaxLength(200);
        builder.Property(u => u.UpdatedBy).HasMaxLength(200);

        // Unique among live accounts only, so an address can be re-used after a soft delete.
        builder.HasIndex(u => u.Email).IsUnique().HasFilter("[IsDeleted] = 0").HasDatabaseName(EmailIndexName);
    }
}
