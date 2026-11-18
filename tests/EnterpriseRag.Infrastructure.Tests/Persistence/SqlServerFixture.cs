using Testcontainers.MsSql;

namespace EnterpriseRag.Infrastructure.Tests.Persistence;

public sealed class SqlServerFixture : IAsyncLifetime
{
    private readonly MsSqlContainer _container = new MsSqlBuilder("mcr.microsoft.com/mssql/server:2022-CU14-ubuntu-22.04").Build();

    public Task InitializeAsync() => _container.StartAsync();

    public Task DisposeAsync() => _container.DisposeAsync().AsTask();

    /// <summary>Connection string pointing at a fresh, uniquely named database.</summary>
    public string NewDatabaseConnectionString()
    {
        var builder = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(_container.GetConnectionString())
        {
            InitialCatalog = "t_" + Guid.NewGuid().ToString("N"),
        };
        return builder.ConnectionString;
    }
}

[CollectionDefinition(Name)]
public sealed class SqlServerCollection : ICollectionFixture<SqlServerFixture>
{
    public const string Name = "SqlServer";
}
