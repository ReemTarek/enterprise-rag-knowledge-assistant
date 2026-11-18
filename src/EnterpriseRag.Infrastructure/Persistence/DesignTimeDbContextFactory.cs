using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace EnterpriseRag.Infrastructure.Persistence;

/// <summary>Used only by dotnet-ef. Reads the connection string from the environment, never from files.</summary>
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public const string EnvironmentVariable = "Database__ConnectionString";

    public AppDbContext CreateDbContext(string[] args)
    {
        // Migration scaffolding does not connect, so a placeholder is enough when the variable is unset.
        var connectionString = Environment.GetEnvironmentVariable(EnvironmentVariable)
            ?? "Server=(local);Database=EnterpriseRagDesignTime;Trusted_Connection=True;TrustServerCertificate=True";
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connectionString).Options;
        return new AppDbContext(options);
    }
}
