using System.Net;
using EnterpriseRag.API.IntegrationTests.Support;

namespace EnterpriseRag.API.IntegrationTests;

[Collection(ApiDatabaseCollection.Name)]
public sealed class HealthTests(ApiDatabaseFixture db)
{
    private const string Sentinel = "SENTINEL_PWD_123";

    private static string UnreachableConnectionString =>
        $"Server=127.0.0.1,1;Database=Fake;User Id=sentinel_user;Password={Sentinel};Connect Timeout=2;TrustServerCertificate=True";

    private static void AssertNoLeaks(string body)
    {
        Assert.DoesNotContain(Sentinel, body);
        Assert.DoesNotContain("sentinel_user", body);
        Assert.DoesNotContain("127.0.0.1", body);
        Assert.DoesNotContain("Server=", body);
        Assert.DoesNotContain("Exception", body);
        Assert.DoesNotContain("SqlException", body);
        Assert.DoesNotContain("   at ", body);
        Assert.DoesNotContain("\"data\"", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\"exception\"", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Live_Returns200_EvenWhenDatabaseUnreachable()
    {
        await using var factory = new ApiFactory(connectionString: UnreachableConnectionString);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health/live");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Ready_Returns200_WhenDatabaseUp()
    {
        await using var factory = new ApiFactory(connectionString: db.ConnectionString);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health/ready");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("Healthy", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Ready_Returns503_WhenDatabaseDown()
    {
        await using var factory = new ApiFactory(connectionString: UnreachableConnectionString);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health/ready");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Contains("Unhealthy", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Ready_Body_DoesNotContainConnectionString()
    {
        var up = db.ConnectionString;
        var password = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(up).Password;

        await using (var down = new ApiFactory(connectionString: UnreachableConnectionString))
        {
            using var client = down.CreateClient();
            var body = await (await client.GetAsync("/health/ready")).Content.ReadAsStringAsync();
            AssertNoLeaks(body);
        }

        await using (var healthy = new ApiFactory(connectionString: up))
        {
            using var client = healthy.CreateClient();
            var response = await client.GetAsync("/health/ready");
            var body = await response.Content.ReadAsStringAsync();
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            AssertNoLeaks(body);
            Assert.DoesNotContain(password, body);
            Assert.DoesNotContain("Password", body);
        }
    }
}
