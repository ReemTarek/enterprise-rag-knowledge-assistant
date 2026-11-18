using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Infrastructure.Persistence;
using EnterpriseRag.Infrastructure.Time;
using EnterpriseRag.Shared.Options;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace EnterpriseRag.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddValidatedOptions<DatabaseOptions>(configuration, "Database");
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

        return services;
    }
}
