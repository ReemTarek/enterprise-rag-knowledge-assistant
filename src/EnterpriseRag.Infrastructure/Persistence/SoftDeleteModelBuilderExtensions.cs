using System.Linq.Expressions;
using EnterpriseRag.Domain.Common;
using Microsoft.EntityFrameworkCore;

namespace EnterpriseRag.Infrastructure.Persistence;

public static class SoftDeleteModelBuilderExtensions
{
    /// <summary>
    /// Applies IsDeleted == false as a global query filter to every entity type
    /// deriving from SoftDeletableEntity. Call after entities are configured.
    /// </summary>
    public static ModelBuilder ApplySoftDeleteFilter(this ModelBuilder modelBuilder)
    {
        foreach (var entityType in modelBuilder.Model.GetEntityTypes())
        {
            // Only the root of a hierarchy may declare a filter.
            if (entityType.BaseType is null && typeof(SoftDeletableEntity).IsAssignableFrom(entityType.ClrType))
            {
                var parameter = Expression.Parameter(entityType.ClrType, "e");
                var body = Expression.Equal(
                    Expression.Property(parameter, nameof(SoftDeletableEntity.IsDeleted)),
                    Expression.Constant(false));
                modelBuilder.Entity(entityType.ClrType)
                    .HasQueryFilter(Expression.Lambda(body, parameter));
            }
        }

        return modelBuilder;
    }
}
