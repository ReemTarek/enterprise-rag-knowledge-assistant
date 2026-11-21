using System.Text.Json;
using EnterpriseRag.API.Middleware;
using EnterpriseRag.Application.Common;
using EnterpriseRag.Application.Security;
using EnterpriseRag.Domain.Common;
using FluentValidation;
using FluentValidation.Results;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace EnterpriseRag.API.IntegrationTests;

/// <summary>Drives <see cref="GlobalExceptionHandler"/> directly with a real ProblemDetails service.</summary>
public sealed class GlobalExceptionHandlerTests
{
    private readonly CapturingLogger _logger = new();

    private async Task<(int Status, JsonElement? Body, HttpContext Context)> HandleAsync(
        Exception exception, string environment = "Production", Action<HttpContext>? arrange = null)
    {
        var services = new ServiceCollection().AddLogging().AddProblemDetails().BuildServiceProvider();
        var context = new DefaultHttpContext { RequestServices = services };
        context.Response.Body = new MemoryStream();
        context.Items[CorrelationIdMiddleware.ItemKey] = "corr-1";
        arrange?.Invoke(context);

        var handler = new GlobalExceptionHandler(
            services.GetRequiredService<Microsoft.AspNetCore.Http.IProblemDetailsService>(), new TestEnvironment(environment), _logger);

        Assert.True(await handler.TryHandleAsync(context, exception, CancellationToken.None));

        context.Response.Body.Position = 0;
        var text = await new StreamReader(context.Response.Body).ReadToEndAsync();
        JsonElement? body = text.Length == 0 ? null : JsonDocument.Parse(text).RootElement.Clone();
        return (context.Response.StatusCode, body, context);
    }

    [Theory]
    [InlineData("notfound", 404)]
    [InlineData("denied", 403)]
    [InlineData("conflict", 409)]
    [InlineData("concurrency", 412)]
    [InlineData("auth", 401)]
    [InlineData("domain", 400)]
    public async Task Exception_Mapping_KnownExceptions_MapToStatus_WithCorrelationId(string kind, int expected)
    {
        Exception exception = kind switch
        {
            "notfound" => new NotFoundException(NotFoundException.KnowledgeBase),
            "denied" => new AccessDeniedException(),
            "conflict" => new ConflictException("A user with this email already exists."),
            "concurrency" => new ConcurrencyConflictException("The record was modified by another request. Reload it and try again."),
            "auth" => new AuthenticationFailedException(),
            _ => new DomainException("Name is required"),
        };

        var (status, body, context) = await HandleAsync(exception);

        Assert.Equal(expected, status);
        Assert.Equal("application/problem+json", context.Response.ContentType?.Split(';')[0]);
        Assert.Equal(expected, body!.Value.GetProperty("status").GetInt32());
        Assert.Equal("corr-1", body.Value.GetProperty("correlationId").GetString());
        Assert.Equal(exception.Message, body.Value.GetProperty("detail").GetString());
        Assert.DoesNotContain("Exception", body.Value.GetRawText());
        Assert.DoesNotContain(_logger.Entries, e => e.Level >= LogLevel.Error);
        Assert.All(_logger.Entries, e => Assert.Null(e.Exception)); // no stack-trace spam for expected 4xx
    }

    [Fact]
    public async Task Exception_Mapping_AuthenticationFailed_IsGeneric()
    {
        var (_, body, _) = await HandleAsync(new AuthenticationFailedException());

        Assert.Equal("Invalid credentials.", body!.Value.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task Exception_Mapping_Validation_Returns400_WithFieldErrors_WithoutAttemptedValues()
    {
        var exception = new ValidationException(
        [
            new ValidationFailure("NewPassword", "Password must contain a digit.") { AttemptedValue = "secret-attempt" },
            new ValidationFailure("NewPassword", "Too short.") { AttemptedValue = "secret-attempt" },
            new ValidationFailure("CurrentPassword", "The current password is incorrect.") { AttemptedValue = "old-secret" },
        ]);

        var (status, body, _) = await HandleAsync(exception);

        Assert.Equal(400, status);
        var raw = body!.Value.GetRawText();
        Assert.DoesNotContain("secret-attempt", raw);
        Assert.DoesNotContain("old-secret", raw);
        var errors = body.Value.GetProperty("errors");
        Assert.Equal(["Password must contain a digit.", "Too short."],
            errors.GetProperty("NewPassword").EnumerateArray().Select(e => e.GetString()));
        Assert.Single(errors.GetProperty("CurrentPassword").EnumerateArray());
        Assert.Equal("corr-1", body.Value.GetProperty("correlationId").GetString());
    }

    [Fact]
    public async Task Exception_Mapping_BadHttpRequest_UsesItsStatusCode()
    {
        var (status, body, _) = await HandleAsync(new BadHttpRequestException("Request body too large. internal-detail", 413));

        Assert.Equal(413, status);
        Assert.Equal(413, body!.Value.GetProperty("status").GetInt32());
        Assert.DoesNotContain("internal-detail", body.Value.GetRawText());
    }

    [Fact]
    public async Task Exception_Mapping_CancelledByClient_Returns499_WithoutErrorLog()
    {
        using var aborted = new CancellationTokenSource();
        await aborted.CancelAsync();

        var (status, body, _) = await HandleAsync(new OperationCanceledException(), arrange: c => c.RequestAborted = aborted.Token);

        Assert.Equal(499, status);
        Assert.Null(body);
        Assert.All(_logger.Entries, e => Assert.Equal(LogLevel.Debug, e.Level));
    }

    [Fact]
    public async Task Exception_Mapping_CancelledWithoutAbort_IsAServerError()
    {
        var (status, _, _) = await HandleAsync(new OperationCanceledException());

        Assert.Equal(500, status);
        Assert.Contains(_logger.Entries, e => e.Level == LogLevel.Error);
    }

    [Fact]
    public async Task Exception_Mapping_Unhandled_Returns500_Generic_LogsError()
    {
        var (status, body, _) = await HandleAsync(new InvalidOperationException("internal-secret"));

        Assert.Equal(500, status);
        Assert.DoesNotContain("internal-secret", body!.Value.GetRawText());
        Assert.Contains(_logger.Entries, e => e.Level == LogLevel.Error && e.Exception is InvalidOperationException);
    }

    private sealed class TestEnvironment(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;

        public string ApplicationName { get; set; } = "Tests";

        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;

        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private sealed record LogEntry(LogLevel Level, Exception? Exception);

    private sealed class CapturingLogger : ILogger<GlobalExceptionHandler>
    {
        public List<LogEntry> Entries { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Entries.Add(new LogEntry(logLevel, exception));
    }
}
