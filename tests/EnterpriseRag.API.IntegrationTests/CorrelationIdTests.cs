using EnterpriseRag.API.Middleware;
using Microsoft.AspNetCore.Http;

namespace EnterpriseRag.API.IntegrationTests;

public class CorrelationIdTests
{
    private const string Header = "X-Correlation-ID";

    [Fact]
    public async Task ValidCorrelationId_IsEchoed()
    {
        await using var factory = new ApiFactory();
        var client = factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Get, "/");
        request.Headers.Add(Header, "abc-123_X.9");

        var response = await client.SendAsync(request);

        Assert.Equal("abc-123_X.9", Assert.Single(response.Headers.GetValues(Header)));
    }

    [Fact]
    public async Task MissingCorrelationId_GeneratesGuid()
    {
        await using var factory = new ApiFactory();
        var client = factory.CreateClient();

        var response = await client.GetAsync("/");

        var value = Assert.Single(response.Headers.GetValues(Header));
        Assert.True(Guid.TryParse(value, out _));
    }

    [Theory]
    [InlineData("oversized")]
    [InlineData("space")]
    public async Task HostileCorrelationId_OversizedOrWithNewlines_IsReplaced(string kind)
    {
        await using var factory = new ApiFactory();
        var client = factory.CreateClient();
        var hostile = kind == "oversized" ? new string('a', 65) : "has space";
        var request = new HttpRequestMessage(HttpMethod.Get, "/");
        request.Headers.TryAddWithoutValidation(Header, hostile);

        var response = await client.SendAsync(request);

        var value = Assert.Single(response.Headers.GetValues(Header));
        Assert.NotEqual(hostile, value);
        Assert.True(Guid.TryParse(value, out _));
    }

    [Theory]
    [InlineData("abc\r\nInjected: 1")]
    [InlineData("abc\n")]
    [InlineData("abc\n1")]
    public async Task HostileCorrelationId_OversizedOrWithNewlines_IsReplaced_Newlines(string hostile)
    {
        // HttpClient refuses to send raw CR/LF, so exercise the middleware directly.
        var ctx = new DefaultHttpContext();
        ctx.Request.Headers[Header] = hostile;
        var middleware = new CorrelationIdMiddleware(_ => Task.CompletedTask);

        await middleware.InvokeAsync(ctx);

        Assert.True(Guid.TryParse(ctx.Response.Headers[Header].ToString(), out _));
    }
}
