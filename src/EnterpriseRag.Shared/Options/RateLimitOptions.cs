using System.ComponentModel.DataAnnotations;

namespace EnterpriseRag.Shared.Options;

/// <summary>
/// Per-client-IP fixed-window (1 minute) limits of the anonymous token endpoints, bound from the <c>RateLimit</c>
/// configuration section. The defaults are the production values (SECURITY.md); only test environments (the E2E stack,
/// where every browser and worker shares one IP) raise them.
/// </summary>
public sealed class RateLimitOptions
{
    public const string SectionName = "RateLimit";

    /// <summary>Login and password change (shared bucket: both are current-password oracles).</summary>
    [Range(1, 100_000)]
    public int LoginPermitsPerMinute { get; set; } = 10;

    /// <summary>Refresh and logout.</summary>
    [Range(1, 100_000)]
    public int RefreshPermitsPerMinute { get; set; } = 30;
}
