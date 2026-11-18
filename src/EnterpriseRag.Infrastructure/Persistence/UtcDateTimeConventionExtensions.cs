using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace EnterpriseRag.Infrastructure.Persistence;

public static class UtcDateTimeConventionExtensions
{
    /// <summary>
    /// Makes every DateTime/DateTime? property round-trip as UTC: UTC values are stored as-is,
    /// Local values are converted, Unspecified values are rejected; values read back are Kind=Utc.
    /// </summary>
    public static ModelConfigurationBuilder ApplyUtcDateTimeConvention(this ModelConfigurationBuilder configurationBuilder)
    {
        configurationBuilder.Properties<DateTime>().HaveConversion<UtcDateTimeConverter>();
        configurationBuilder.Properties<DateTime?>().HaveConversion<NullableUtcDateTimeConverter>();
        return configurationBuilder;
    }

    private static DateTime ToUtcForWrite(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => throw new InvalidOperationException(
            "DateTime values must have Kind=Utc or Kind=Local; Kind=Unspecified is rejected."),
    };

    private sealed class UtcDateTimeConverter() : ValueConverter<DateTime, DateTime>(
        v => ToUtcForWrite(v), v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

    private sealed class NullableUtcDateTimeConverter() : ValueConverter<DateTime?, DateTime?>(
        v => v.HasValue ? ToUtcForWrite(v.Value) : v,
        v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v);
}
