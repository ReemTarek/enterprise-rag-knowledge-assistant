using System.ComponentModel.DataAnnotations;

namespace EnterpriseRag.Shared.Options;

public sealed class DatabaseOptions
{
    [Required(AllowEmptyStrings = false)]
    public string ConnectionString { get; set; } = string.Empty;
}
