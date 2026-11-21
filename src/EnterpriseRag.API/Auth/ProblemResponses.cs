using EnterpriseRag.API.Middleware;
using Microsoft.AspNetCore.Mvc;

namespace EnterpriseRag.API.Auth;

/// <summary>Writes ProblemDetails bodies from outside MVC (authentication challenges, authorization denials, rate-limit rejections).</summary>
public static class ProblemResponses
{
    public static async Task WriteAsync(HttpContext context, int status, string title, string detail, string type)
    {
        if (context.Response.HasStarted)
        {
            return;
        }

        context.Response.StatusCode = status;
        var problem = new ProblemDetails { Type = type, Status = status, Title = title, Detail = detail };
        problem.Extensions["correlationId"] = CorrelationIdMiddleware.Get(context);
        await context.RequestServices.GetRequiredService<IProblemDetailsService>()
            .TryWriteAsync(new ProblemDetailsContext { HttpContext = context, ProblemDetails = problem });
    }
}
