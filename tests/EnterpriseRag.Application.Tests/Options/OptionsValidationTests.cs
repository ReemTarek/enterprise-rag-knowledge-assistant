using EnterpriseRag.Shared.Options;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace EnterpriseRag.Application.Tests.Options;

public class OptionsValidationTests
{
    private static ServiceProvider Build(Dictionary<string, string?> values, Action<IServiceCollection, IConfiguration>? register = null)
    {
        IConfiguration config = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        var services = new ServiceCollection();
        if (register is null)
        {
            services.AddValidatedOptions<DatabaseOptions>(config, "Database");
            services.AddValidatedOptions<OllamaOptions>(config, "Ai:Ollama");
            services.AddValidatedOptions<RagOptions>(config, "Rag");
        }
        else
        {
            register(services, config);
        }
        return services.BuildServiceProvider();
    }

    private static Dictionary<string, string?> Valid() => new()
    {
        ["Database:ConnectionString"] = "Host=localhost;Database=rag",
        ["Ai:Ollama:EmbeddingDimensions"] = "768",
        ["Rag:ChunkSize"] = "700",
        ["Rag:ChunkOverlap"] = "100",
        ["Rag:TopK"] = "5",
    };

    [Fact]
    public void ValidConfiguration_Resolves()
    {
        using var sp = Build(Valid());
        Assert.Equal(768, sp.GetRequiredService<IOptions<OllamaOptions>>().Value.EmbeddingDimensions);
        Assert.NotNull(sp.GetRequiredService<IOptions<DatabaseOptions>>().Value.ConnectionString);
        Assert.Equal(5, sp.GetRequiredService<IOptions<RagOptions>>().Value.TopK);
    }

    [Fact]
    public void EmptyConnectionString_FailsValidation()
    {
        var v = Valid();
        v["Database:ConnectionString"] = "";
        using var sp = Build(v);
        Assert.Throws<OptionsValidationException>(() => sp.GetRequiredService<IOptions<DatabaseOptions>>().Value);
    }

    [Fact]
    public void NonHttpOllamaBaseUrl_FailsValidation()
    {
        var v = Valid();
        v["Ai:Ollama:BaseUrl"] = "ftp://localhost:11434";
        using var sp = Build(v);
        Assert.Throws<OptionsValidationException>(() => sp.GetRequiredService<IOptions<OllamaOptions>>().Value);
    }

    [Fact]
    public void RelativeOllamaBaseUrl_FailsValidation()
    {
        var v = Valid();
        v["Ai:Ollama:BaseUrl"] = "localhost:11434/foo";
        using var sp = Build(v);
        Assert.Throws<OptionsValidationException>(() => sp.GetRequiredService<IOptions<OllamaOptions>>().Value);
    }

    [Fact]
    public void MissingEmbeddingDimensions_FailsValidation()
    {
        var v = Valid();
        v.Remove("Ai:Ollama:EmbeddingDimensions");
        using var sp = Build(v);
        Assert.Throws<OptionsValidationException>(() => sp.GetRequiredService<IOptions<OllamaOptions>>().Value);
    }

    [Theory]
    [InlineData(100, 100)]
    [InlineData(700, 800)]
    public void ChunkOverlap_GreaterOrEqualChunkSize_FailsValidation(int size, int overlap)
    {
        var v = Valid();
        v["Rag:ChunkSize"] = size.ToString();
        v["Rag:ChunkOverlap"] = overlap.ToString();
        using var sp = Build(v);
        Assert.Throws<OptionsValidationException>(() => sp.GetRequiredService<IOptions<RagOptions>>().Value);
    }

    [Fact]
    public void TopK_Zero_FailsValidation()
    {
        var v = Valid();
        v["Rag:TopK"] = "0";
        using var sp = Build(v);
        Assert.Throws<OptionsValidationException>(() => sp.GetRequiredService<IOptions<RagOptions>>().Value);
    }

    [Fact]
    public void Defaults_MatchSpec()
    {
        var ai = new AiOptions();
        Assert.Equal("Ollama", ai.Provider);
        Assert.NotNull(ai.Ollama);
        var o = new OllamaOptions();
        Assert.Equal("http://localhost:11434", o.BaseUrl);
        Assert.Equal("qwen3:8b", o.ChatModel);
        Assert.Equal("nomic-embed-text", o.EmbeddingModel);
        Assert.Equal(180, o.TimeoutSeconds);
        Assert.Equal(0, o.EmbeddingDimensions);
        var r = new RagOptions();
        Assert.Equal(700, r.ChunkSize);
        Assert.Equal(100, r.ChunkOverlap);
        Assert.Equal(5, r.TopK);
    }

    [Fact]
    public async Task ValidateOnStart_FailsHostStartup_WithoutAccessingOptions()
    {
        var builder = Host.CreateApplicationBuilder();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["Rag:TopK"] = "0" });
        builder.Services.AddValidatedOptions<RagOptions>(builder.Configuration, "Rag");
        using var host = builder.Build();
        await Assert.ThrowsAsync<OptionsValidationException>(() => host.StartAsync());
    }
}

public class SecurityOptionsTests
{
    [Fact]
    public void SecurityOptions_Defaults_MatchSpec()
    {
        var s = new SecurityOptions();
        Assert.Equal(5, s.MaxFailedLogins);
        Assert.Equal(15, s.LockoutMinutes);
        Assert.Equal(12, s.MinPasswordLength);
    }

    [Theory]
    [InlineData("Security:MaxFailedLogins", "0")]
    [InlineData("Security:LockoutMinutes", "0")]
    [InlineData("Security:MinPasswordLength", "4")]
    public void SecurityOptions_OutOfRange_FailsValidation(string key, string value)
    {
        IConfiguration config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { [key] = value }).Build();
        var services = new ServiceCollection();
        services.AddValidatedOptions<SecurityOptions>(config, SecurityOptions.SectionName);
        using var sp = services.BuildServiceProvider();
        Assert.Throws<OptionsValidationException>(() => sp.GetRequiredService<IOptions<SecurityOptions>>().Value);
    }
}

public class AiOptionsNestedValidationTests
{
    private static ServiceProvider Build(string? baseUrl, string? dims)
    {
        var values = new Dictionary<string, string?>();
        if (baseUrl is not null) values["AI:Ollama:BaseUrl"] = baseUrl;
        if (dims is not null) values["AI:Ollama:EmbeddingDimensions"] = dims;
        IConfiguration config = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        var services = new ServiceCollection();
        services.AddValidatedOptions<AiOptions>(config, "AI");
        return services.BuildServiceProvider();
    }

    [Fact]
    public void AiOptions_UnsetEmbeddingDimensions_FailsValidation()
    {
        using var sp = Build(null, null);
        Assert.Throws<OptionsValidationException>(() => sp.GetRequiredService<IOptions<AiOptions>>().Value);
    }

    [Fact]
    public void AiOptions_FtpOllamaBaseUrl_FailsValidation()
    {
        using var sp = Build("ftp://x", "768");
        Assert.Throws<OptionsValidationException>(() => sp.GetRequiredService<IOptions<AiOptions>>().Value);
    }

    [Fact]
    public void AiOptions_ValidNested_Resolves()
    {
        using var sp = Build(null, "768");
        Assert.Equal(768, sp.GetRequiredService<IOptions<AiOptions>>().Value.Ollama.EmbeddingDimensions);
    }
}
