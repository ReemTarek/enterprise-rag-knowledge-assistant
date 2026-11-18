using EnterpriseRag.Domain.Common;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace EnterpriseRag.API.IntegrationTests;

public sealed class ApiFactory(string environment = "Production") : WebApplicationFactory<Program>
{
    public const string FakeConnectionString =
        "Server=localhost,1;Database=Fake;User Id=x;Password=x;TrustServerCertificate=True";

    public const string SecretMessage = "super-secret-internal-detail";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(environment);
        builder.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:ConnectionString"] = FakeConnectionString,
            }));
        builder.ConfigureServices(services =>
            services.AddTransient<IStartupFilter, TestEndpointsFilter>());
    }

    private sealed class TestEndpointsFilter : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            next(app);
            app.Map("/test/throw", b => b.Run(_ => throw new InvalidOperationException(SecretMessage)));
            app.Map("/test/domain", b => b.Run(_ => throw new DomainException("Name is required")));
        };
    }
}
