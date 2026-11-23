using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Infrastructure.Persistence;
using EnterpriseRag.Infrastructure.Security;
using EnterpriseRag.Infrastructure.Seed;
using EnterpriseRag.Infrastructure.Time;
using EnterpriseRag.Shared.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;

namespace EnterpriseRag.Infrastructure;

public static class DependencyInjection
{
    /// <summary>
    /// Registers infrastructure adapters only (persistence, security, seed). The host registers
    /// <c>ICurrentUserService</c> and calls <c>AddApplication()</c> for the use-case handlers.
    /// </summary>
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddValidatedOptions<DatabaseOptions>(configuration, "Database");
        services.AddValidatedOptions<JwtOptions>(configuration, JwtOptions.SectionName);
        services.AddValidatedOptions<SeedOptions>(configuration, SeedOptions.SectionName);
        services.AddValidatedOptions<SecurityOptions>(configuration, SecurityOptions.SectionName);
        services.AddSingleton(sp => sp.GetRequiredService<IOptions<SecurityOptions>>().Value);

        services.AddSingleton<IDateTimeProvider, SystemDateTimeProvider>();
        services.AddScoped<AuditableEntityInterceptor>();
        services.AddSingleton<AuditLogAppendOnlyInterceptor>();

        services.AddDbContext<AppDbContext>((sp, options) =>
        {
            var db = sp.GetRequiredService<IOptions<DatabaseOptions>>().Value;
            options.UseSqlServer(db.ConnectionString)
                .AddInterceptors(
                    sp.GetRequiredService<AuditableEntityInterceptor>(),
                    sp.GetRequiredService<AuditLogAppendOnlyInterceptor>());
        });
        services.AddScoped<IAppDbContext>(sp => sp.GetRequiredService<AppDbContext>());
        services.AddSingleton<IAsyncQueryExecutor, EfAsyncQueryExecutor>();
        services.AddScoped<IAuditLogger, AuditLogger>();

        services.AddSingleton<IPasswordHasher, IdentityPasswordHasher>();
        services.AddSingleton<ITokenService, JwtTokenService>();

        services.AddHostedService<AdminSeedHostedService>();

        services.AddHealthChecks()
            .AddDbContextCheck<AppDbContext>("sqlserver", failureStatus: HealthStatus.Unhealthy, tags: ["ready"], customTestQuery: null);

        return services;
    }
}
