namespace EnterpriseRag.Shared.Options;

/// <summary>
/// Initial administrator, bound from the <c>Seed</c> section. Only required when the database has no users; supply
/// the password through a secret store or environment variable (<c>Seed__AdminPassword</c>), never a committed file.
/// </summary>
public sealed class SeedOptions
{
    public const string SectionName = "Seed";

    public string? AdminEmail { get; set; }

    public string? AdminPassword { get; set; }
}
