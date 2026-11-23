using System.ComponentModel.DataAnnotations;

namespace EnterpriseRag.Shared.Options;

/// <summary>Account-security policy, bound from the <c>Security</c> configuration section.</summary>
public sealed class SecurityOptions
{
    public const string SectionName = "Security";

    [Range(1, 100)]
    public int MaxFailedLogins { get; set; } = 5;

    [Range(1, 24 * 60)]
    public int LockoutMinutes { get; set; } = 15;

    [Range(8, 128)]
    public int MinPasswordLength { get; set; } = 12;
}
