using System.ComponentModel.DataAnnotations;

namespace EnterpriseRag.Shared.Options;

public sealed class AiOptions
{
    [Required(AllowEmptyStrings = false)]
    public string Provider { get; set; } = "Ollama";

    [Required]
    public OllamaOptions Ollama { get; set; } = new();
}
