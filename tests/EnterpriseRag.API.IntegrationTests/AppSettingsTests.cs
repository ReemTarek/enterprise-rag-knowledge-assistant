using EnterpriseRag.Shared.Options;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace EnterpriseRag.API.IntegrationTests;

public class AppSettingsTests
{
    private static string RepoFile(string relative)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "EnterpriseRag.sln")))
        {
            dir = dir.Parent;
        }

        Assert.NotNull(dir);
        return Path.Combine(dir.FullName, relative);
    }

    [Theory]
    [InlineData("src/EnterpriseRag.Worker/appsettings.json")]
    [InlineData("src/EnterpriseRag.Worker/appsettings.Development.json")]
    [InlineData("src/EnterpriseRag.API/appsettings.json")]
    [InlineData("src/EnterpriseRag.API/appsettings.Development.json")]
    public void WorkerAppSettings_AreValidJson_AndOptionsValidate(string file)
    {
        var path = RepoFile(file);
        var configuration = new ConfigurationBuilder()
            .AddJsonFile(path, optional: false)
            .Build();

        if (file.EndsWith("appsettings.json", StringComparison.Ordinal))
        {
            var services = new ServiceCollection();
            services.AddValidatedOptions<AiOptions>(configuration, "Ai");
            services.AddValidatedOptions<RagOptions>(configuration, "Rag");
            using var provider = services.BuildServiceProvider();

            Assert.True(provider.GetRequiredService<IOptions<AiOptions>>().Value.Ollama.EmbeddingDimensions > 0);
            Assert.True(provider.GetRequiredService<IOptions<RagOptions>>().Value.TopK > 0);
        }
    }
}
