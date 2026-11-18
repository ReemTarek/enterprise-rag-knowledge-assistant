using System.ComponentModel.DataAnnotations;

namespace EnterpriseRag.Shared.Options;

public sealed class RagOptions : IValidatableObject
{
    [Range(1, int.MaxValue)]
    public int ChunkSize { get; set; } = 700;

    [Range(0, int.MaxValue)]
    public int ChunkOverlap { get; set; } = 100;

    [Range(1, int.MaxValue)]
    public int TopK { get; set; } = 5;

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (ChunkOverlap >= ChunkSize)
        {
            yield return new ValidationResult(
                "ChunkOverlap must be less than ChunkSize.", [nameof(ChunkOverlap)]);
        }
    }
}
