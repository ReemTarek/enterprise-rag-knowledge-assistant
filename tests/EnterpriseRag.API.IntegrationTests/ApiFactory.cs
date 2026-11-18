using EnterpriseRag.Domain.Common;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace EnterpriseRag.API.IntegrationTests;

public sealed class ApiFactory(string environment = "Production", string? connectionString = null) : WebApplicationFactory<Program>
{
    // Short connect timeout: the startup admin seed probes the database and must give up quickly when it is down.
    public const string FakeConnectionString =
        "Server=localhost,1;Database=Fake;User Id=x;Password=x;Connect Timeout=2;TrustServerCertificate=True";

    public const string SecretMessage = "super-secret-internal-detail";

    public const string TestSigningKey = "api-test-signing-key-at-least-32-bytes-long";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(environment);
        builder.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:ConnectionString"] = connectionString ?? FakeConnectionString,
                ["Jwt:Issuer"] = "EnterpriseRag.Tests",
                ["Jwt:Audience"] = "EnterpriseRag.Tests",
                ["Jwt:SigningKey"] = TestSigningKey,
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
