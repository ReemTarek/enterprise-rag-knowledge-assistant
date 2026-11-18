using EnterpriseRag.Domain.Common;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace EnterpriseRag.API.Middleware;

public sealed class GlobalExceptionHandler(
    IProblemDetailsService problemDetails,
    IHostEnvironment environment,
    ILogger<GlobalExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var correlationId = CorrelationIdMiddleware.Get(httpContext);
        var isDomain = exception is DomainException;

        if (isDomain)
        {
            logger.LogWarning(exception, "Domain rule violated. CorrelationId={CorrelationId}", correlationId);
        }
        else
        {
            logger.LogError(exception, "Unhandled exception. CorrelationId={CorrelationId}", correlationId);
        }

        var problem = new ProblemDetails
        {
            Status = isDomain ? StatusCodes.Status400BadRequest : StatusCodes.Status500InternalServerError,
            Title = isDomain ? "Business rule violation" : "An unexpected error occurred",
            Detail = isDomain
                ? exception.Message
                : environment.IsDevelopment() ? exception.Message : "An unexpected error occurred. Include the correlation id when contacting support.",
        };
        problem.Extensions["correlationId"] = correlationId;

        httpContext.Response.StatusCode = problem.Status.Value;
        // The exception middleware clears response headers before invoking handlers.
        if (correlationId is not null)
        {
            httpContext.Response.Headers[CorrelationIdMiddleware.HeaderName] = correlationId;
        }

        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            ProblemDetails = problem,
            Exception = environment.IsDevelopment() ? exception : null,
        });
    }
}
