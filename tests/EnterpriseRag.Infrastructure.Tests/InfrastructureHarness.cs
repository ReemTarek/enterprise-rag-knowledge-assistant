using EnterpriseRag.Application;
using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Infrastructure.Persistence;
using EnterpriseRag.Infrastructure.Tests.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace EnterpriseRag.Infrastructure.Tests;

/// <summary>Builds the real Infrastructure + Application composition against a test database.</summary>
public static class InfrastructureHarness
{
    public const string SigningKey = "test-signing-key-that-is-at-least-32-bytes-long";
    public const string Issuer = "test-issuer";
    public const string Audience = "test-audience";

    public static Dictionary<string, string?> BaseSettings(string connectionString) => new()
    {
        ["Database:ConnectionString"] = connectionString,
        ["Jwt:Issuer"] = Issuer,
        ["Jwt:Audience"] = Audience,
        ["Jwt:SigningKey"] = SigningKey,
    };

    public static ServiceProvider Build(
        string connectionString,
        IDateTimeProvider clock,
        Dictionary<string, string?>? overrides = null,
        string? currentUserId = null)
    {
        var settings = BaseSettings(connectionString);
        foreach (var (key, value) in overrides ?? [])
        {
            settings[key] = value;
        }

        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddInfrastructure(configuration);
        services.AddApplication();
        services.AddSingleton(clock);
        services.AddScoped<ICurrentUserService>(_ => new FakeCurrentUser(currentUserId));
        return services.BuildServiceProvider(validateScopes: true);
    }

    public static async Task MigrateAsync(IServiceProvider services)
    {
        await using var scope = services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
    }
}
