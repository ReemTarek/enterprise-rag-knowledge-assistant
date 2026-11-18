using System.Net;
using System.Text.Json;
using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;

namespace EnterpriseRag.API.IntegrationTests;

public class ErrorHandlingTests
{
    [Fact]
    public async Task UnhandledException_Production_ReturnsProblemDetailsWithoutStackTrace()
    {
        await using var factory = new ApiFactory("Production");
        var client = factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Get, "/test/throw");
        request.Headers.Add("X-Correlation-ID", "corr-500");

        var response = await client.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.DoesNotContain(ApiFactory.SecretMessage, body);
        Assert.DoesNotContain("at EnterpriseRag", body);
        Assert.DoesNotContain("InvalidOperationException", body);
        Assert.DoesNotContain("StackTrace", body, StringComparison.OrdinalIgnoreCase);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal(500, doc.RootElement.GetProperty("status").GetInt32());
        Assert.Equal("corr-500", doc.RootElement.GetProperty("correlationId").GetString());
        Assert.Equal("corr-500", Assert.Single(response.Headers.GetValues("X-Correlation-ID")));
    }

    [Fact]
    public async Task DomainException_Returns400ProblemDetails()
    {
        await using var factory = new ApiFactory("Production");
        var client = factory.CreateClient();

        var response = await client.GetAsync("/test/domain");
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal(400, doc.RootElement.GetProperty("status").GetInt32());
        Assert.Equal("Name is required", doc.RootElement.GetProperty("detail").GetString());
        Assert.True(doc.RootElement.TryGetProperty("correlationId", out _));
    }

    [Fact]
    public async Task AppDbContext_Resolves_FromApiServiceProvider()
    {
        await using var factory = new ApiFactory("Production");
        using var scope = factory.Services.CreateScope();

        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        Assert.NotNull(db);
        Assert.NotNull(scope.ServiceProvider.GetRequiredService<ICurrentUserService>());
    }
}
