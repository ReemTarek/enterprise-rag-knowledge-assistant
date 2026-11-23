using System.ComponentModel.DataAnnotations;
using System.Text;

namespace EnterpriseRag.Shared.Options;

/// <summary>Access/refresh token settings, bound from the <c>Jwt</c> configuration section.</summary>
public sealed class JwtOptions : IValidatableObject
{
    public const string SectionName = "Jwt";

    /// <summary>HS256 needs a key of at least 256 bits.</summary>
    public const int MinSigningKeyBytes = 32;

    [Required(AllowEmptyStrings = false)]
    public string Issuer { get; set; } = string.Empty;

    [Required(AllowEmptyStrings = false)]
    public string Audience { get; set; } = string.Empty;

    /// <summary>HMAC-SHA256 signing secret. No default on purpose: it must come from a secret store or environment.</summary>
    public string SigningKey { get; set; } = string.Empty;

    [Range(1, 24 * 60)]
    public int AccessTokenMinutes { get; set; } = 15;

    [Range(1, 365)]
    public int RefreshTokenDays { get; set; } = 7;

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (Encoding.UTF8.GetByteCount(SigningKey ?? string.Empty) < MinSigningKeyBytes)
        {
            yield return new ValidationResult(
                $"SigningKey is required and must be at least {MinSigningKeyBytes} bytes (UTF-8).", [nameof(SigningKey)]);
        }
    }
}
