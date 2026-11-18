using System.ComponentModel.DataAnnotations;

namespace EnterpriseRag.Shared.Options;

/// <remarks>
/// Model names and embedding dimensions are configuration only. Business logic must never
/// hardcode model or dimension values; read them from these options.
/// </remarks>
public sealed class OllamaOptions : IValidatableObject
{
    [Required(AllowEmptyStrings = false)]
    public string BaseUrl { get; set; } = "http://localhost:11434";

    [Required(AllowEmptyStrings = false)]
    public string ChatModel { get; set; } = "qwen3:8b";

    [Required(AllowEmptyStrings = false)]
    public string EmbeddingModel { get; set; } = "nomic-embed-text";

    // No default on purpose: it depends on the embedding model and must be configured.
    // An unset value (0) fails validation.
    [Range(1, int.MaxValue)]
    public int EmbeddingDimensions { get; set; }

    [Range(1, int.MaxValue)]
    public int TimeoutSeconds { get; set; } = 180;

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (!Uri.TryCreate(BaseUrl, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            yield return new ValidationResult(
                "BaseUrl must be an absolute http or https URL.", [nameof(BaseUrl)]);
        }
    }
}
