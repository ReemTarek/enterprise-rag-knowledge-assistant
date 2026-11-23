using System.Net;
using System.Text.Json;
using EnterpriseRag.API.IntegrationTests.Support;

namespace EnterpriseRag.API.IntegrationTests;

[Collection(ApiDatabaseCollection.Name)]
public sealed class UserDirectoryTests(ApiDatabaseFixture db) : IAsyncLifetime
{
    private const string Password = "User-Password-123";

    private ApiFactory _factory = null!;
    private HttpClient _client = null!;

    public Task InitializeAsync()
    {
        _factory = db.CreateFactory();
        _client = AuthHttp.CreateClient(_factory);
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    private async Task<string> UserTokenAsync()
    {
        var email = ApiDatabaseFixture.UniqueEmail("caller");
        await ApiDatabaseFixture.CreateUserAsync(_factory, email, Password);
        return (await AuthHttp.LoginAsync(_client, email, Password)).AccessToken;
    }

    private static async Task<JsonElement> JsonAsync(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();

    [Fact]
    public async Task Directory_ReturnsOnlyNameAndEmail()
    {
        var token = await UserTokenAsync();
        var tag = Guid.NewGuid().ToString("N");
        var activeEmail = $"active-{tag}@example.com";
        var inactiveEmail = $"inactive-{tag}@example.com";
        await ApiDatabaseFixture.CreateUserAsync(_factory, activeEmail, Password);
        var inactiveId = await ApiDatabaseFixture.CreateUserAsync(_factory, inactiveEmail, Password);
        await ApiDatabaseFixture.WithDbAsync(_factory, async ctx =>
        {
            var user = await ctx.Users.FindAsync(inactiveId);
            user!.Deactivate();
            await ctx.SaveChangesAsync();
            return 0;
        });

        var response = await AuthHttp.SendAsync(_client, HttpMethod.Get, $"/api/users/directory?query={tag}", token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var item = Assert.Single((await JsonAsync(response)).EnumerateArray().ToList());
        Assert.Equal(activeEmail, item.GetProperty("email").GetString());
        Assert.Equal(
            ["displayName", "email", "id"],
            item.EnumerateObject().Select(p => p.Name).OrderBy(n => n, StringComparer.Ordinal).ToArray());
    }

    [Fact]
    public async Task Directory_ShortQuery_Returns400()
    {
        var token = await UserTokenAsync();

        var response = await AuthHttp.SendAsync(_client, HttpMethod.Get, "/api/users/directory?query=a", token);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Directory_WildcardQuery_DoesNotMatchEverything()
    {
        var token = await UserTokenAsync();
        await ApiDatabaseFixture.CreateUserAsync(_factory, ApiDatabaseFixture.UniqueEmail("plain"), Password);

        foreach (var q in new[] { "%%", "__", "%_" })
        {
            var response = await AuthHttp.SendAsync(_client, HttpMethod.Get, $"/api/users/directory?query={Uri.EscapeDataString(q)}", token);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Empty((await JsonAsync(response)).EnumerateArray());
        }
    }
}
