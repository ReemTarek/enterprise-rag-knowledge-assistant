using EnterpriseRag.API.Http;
using EnterpriseRag.Application.Common;
using EnterpriseRag.Application.Security;
using EnterpriseRag.Domain.Common;
using FluentValidation;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.WebUtilities;

namespace EnterpriseRag.API.Middleware;

/// <summary>
/// Maps exceptions to RFC 7807 responses. Expected (4xx) outcomes are logged once at Information/Warning without the
/// stack trace; anything else is a 500 logged at Error, with a generic detail outside Development. Every body carries
/// the <c>correlationId</c> extension and never internals (attempted values, exception types, stack traces).
/// </summary>
public sealed partial class GlobalExceptionHandler(
    IProblemDetailsService problemDetails,
    IHostEnvironment environment,
    ILogger<GlobalExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var correlationId = CorrelationIdMiddleware.Get(httpContext);

        // The client went away: nobody reads the response, so no error log and no body.
        if (exception is OperationCanceledException && httpContext.RequestAborted.IsCancellationRequested)
        {
            LogRequestAborted(logger, correlationId);
            if (!httpContext.Response.HasStarted)
            {
                httpContext.Response.StatusCode = StatusCodes.Status499ClientClosedRequest;
            }

            return true;
        }

        var problem = Map(exception);
        var status = problem.Status!.Value;
        if (status >= StatusCodes.Status500InternalServerError)
        {
            LogUnhandled(logger, exception, correlationId);
        }
        else if (exception is DomainException or AuthenticationFailedException or AccessDeniedException)
        {
            LogClientErrorWarning(logger, status, exception.GetType().Name, correlationId);
        }
        else
        {
            LogClientErrorInformation(logger, status, exception.GetType().Name, correlationId);
        }

        problem.Extensions["correlationId"] = correlationId;
        httpContext.Response.StatusCode = status;
        // The exception middleware clears response headers before invoking handlers.
        if (correlationId is not null)
        {
            httpContext.Response.Headers[CorrelationIdMiddleware.HeaderName] = correlationId;
        }

        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            ProblemDetails = problem,
            Exception = status >= StatusCodes.Status500InternalServerError && environment.IsDevelopment() ? exception : null,
        });
    }

    private ProblemDetails Map(Exception exception) => exception switch
    {
        // Messages of these types are written for the client by the Application/Domain layers.
        ValidationException validation => new HttpValidationProblemDetails(
            validation.Errors
                .GroupBy(e => e.PropertyName)
                .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).Distinct().ToArray()))
        {
            Type = ProblemTypes.Validation,
            Status = StatusCodes.Status400BadRequest,
            Title = "One or more validation errors occurred.",
        },
        DomainException => Problem(StatusCodes.Status400BadRequest, "Business rule violation", exception.Message, ProblemTypes.BusinessRule),
        AuthenticationFailedException => Problem(StatusCodes.Status401Unauthorized, "Unauthorized", AuthenticationFailedException.GenericMessage),
        AccessDeniedException => Problem(StatusCodes.Status403Forbidden, "Forbidden", exception.Message),
        NotFoundException => Problem(StatusCodes.Status404NotFound, "Not found", exception.Message),
        ConcurrencyConflictException => Problem(StatusCodes.Status412PreconditionFailed, "Precondition Failed", exception.Message),
        ConflictException => Problem(StatusCodes.Status409Conflict, "Conflict", exception.Message),
        BadHttpRequestException bad => Problem(bad.StatusCode, ReasonPhrases.GetReasonPhrase(bad.StatusCode), "The request could not be processed."),
        _ => Problem(
            StatusCodes.Status500InternalServerError,
            "An unexpected error occurred",
            environment.IsDevelopment() ? exception.Message : "An unexpected error occurred. Include the correlation id when contacting support."),
    };

    private static ProblemDetails Problem(int status, string title, string detail, string? type = null) =>
        new() { Type = type ?? ProblemTypes.ForStatus(status), Status = status, Title = title, Detail = detail };

    [LoggerMessage(Level = LogLevel.Debug, Message = "Request aborted by the client. CorrelationId={CorrelationId}")]
    private static partial void LogRequestAborted(ILogger logger, string? correlationId);

    [LoggerMessage(Level = LogLevel.Error, Message = "Unhandled exception. CorrelationId={CorrelationId}")]
    private static partial void LogUnhandled(ILogger logger, Exception exception, string? correlationId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Request rejected with {StatusCode} ({ExceptionType}). CorrelationId={CorrelationId}")]
    private static partial void LogClientErrorWarning(ILogger logger, int statusCode, string exceptionType, string? correlationId);

    [LoggerMessage(Level = LogLevel.Information, Message = "Request failed with {StatusCode} ({ExceptionType}). CorrelationId={CorrelationId}")]
    private static partial void LogClientErrorInformation(ILogger logger, int statusCode, string exceptionType, string? correlationId);
}
