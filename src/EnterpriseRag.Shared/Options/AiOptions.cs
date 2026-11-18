using System.ComponentModel.DataAnnotations;
using Microsoft.Extensions.Options;

namespace EnterpriseRag.Shared.Options;

public sealed class AiOptions
{
    [Required(AllowEmptyStrings = false)]
    public string Provider { get; set; } = "Ollama";

    // ValidateDataAnnotations does not recurse into nested objects on its own, so without
    // [ValidateObjectMembers] an invalid AI:Ollama section would pass silently.
    [ValidateObjectMembers]
    public OllamaOptions Ollama { get; set; } = new();
}
