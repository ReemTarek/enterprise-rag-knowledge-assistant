using EnterpriseRag.API.IntegrationTests.Support;
using EnterpriseRag.Domain.Common;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
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

    /// <summary>Used as both issuer and audience.</summary>
    public const string TestIssuer = "EnterpriseRag.Tests";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(environment);
        builder.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Database:ConnectionString"] = connectionString ?? FakeConnectionString,
                ["Jwt:Issuer"] = TestIssuer,
                ["Jwt:Audience"] = TestIssuer,
                ["Jwt:SigningKey"] = TestSigningKey,
                ["Seed:AdminEmail"] = ApiDatabaseFixture.AdminEmail,
                ["Seed:AdminPassword"] = ApiDatabaseFixture.AdminPassword,
            }));
        // Test-only endpoints live in TestEndpointsController (this assembly) so they run through the real routing,
        // authorization and exception pipeline.
        builder.ConfigureServices(services =>
            services.AddControllers().AddApplicationPart(typeof(ApiFactory).Assembly));
    }
}

[AllowAnonymous]
[Route("test")]
public sealed class TestEndpointsController : ControllerBase
{
    [HttpGet("throw")]
    public IActionResult Throw() => throw new InvalidOperationException(ApiFactory.SecretMessage);

    [HttpGet("domain")]
    public IActionResult Domain() => throw new DomainException("Name is required");
}
