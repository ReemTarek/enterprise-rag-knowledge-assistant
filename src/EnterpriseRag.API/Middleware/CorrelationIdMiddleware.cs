using System.Text.RegularExpressions;
using Serilog.Context;

namespace EnterpriseRag.API.Middleware;

public sealed partial class CorrelationIdMiddleware(RequestDelegate next)
{
    public const string HeaderName = "X-Correlation-ID";
    public const string ItemKey = "CorrelationId";

    [GeneratedRegex(@"^[A-Za-z0-9\-_.]{1,64}\z", RegexOptions.CultureInvariant)]
    private static partial Regex ValidId();

    public async Task InvokeAsync(HttpContext context)
    {
        var incoming = context.Request.Headers[HeaderName].ToString();
        var correlationId = ValidId().IsMatch(incoming) ? incoming : Guid.NewGuid().ToString();

        context.Items[ItemKey] = correlationId;
        context.Response.Headers[HeaderName] = correlationId;

        using (LogContext.PushProperty("CorrelationId", correlationId))
        {
            await next(context);
        }
    }

    public static string? Get(HttpContext context) =>
        context.Items.TryGetValue(ItemKey, out var v) ? v as string : null;
}
