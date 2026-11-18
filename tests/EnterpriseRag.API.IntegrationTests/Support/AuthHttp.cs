using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace EnterpriseRag.API.IntegrationTests.Support;

/// <summary>A login/refresh outcome: status, JSON body and the raw <c>refresh_token</c> Set-Cookie header (if any).</summary>
public sealed record AuthResponse(HttpResponseMessage Response, JsonElement Body, string? SetCookie)
{
    /// <summary>The cookie value (between <c>refresh_token=</c> and the first <c>;</c>).</summary>
    public string? RefreshToken => AuthHttp.CookieValue(SetCookie);

    public string AccessToken => Body.GetProperty("accessToken").GetString()!;
}

/// <summary>
/// The refresh cookie is <c>Secure</c>, so a cookie container would not replay it over the test server's http scheme.
/// Tests therefore read the <c>Set-Cookie</c> header and send the cookie back manually.
/// </summary>
public static class AuthHttp
{
    public const string CookieName = "refresh_token";

    public static HttpClient CreateClient(ApiFactory factory) =>
        factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions { HandleCookies = false });

    public static async Task<AuthResponse> LoginAsync(HttpClient client, string email, string password)
    {
        var response = await client.PostAsJsonAsync("/api/auth/login", new { email, password });
        return await ToAuthResponseAsync(response);
    }

    public static async Task<AuthResponse> RefreshAsync(HttpClient client, string? refreshToken, object? body = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        if (refreshToken is not null)
        {
            request.Headers.Add("Cookie", $"{CookieName}={refreshToken}");
        }

        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        return await ToAuthResponseAsync(await client.SendAsync(request));
    }

    public static Task<HttpResponseMessage> SendAsync(
        HttpClient client, HttpMethod method, string url, string? accessToken = null, string? refreshToken = null, object? body = null)
    {
        var request = new HttpRequestMessage(method, url);
        if (accessToken is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        }

        // Behave like a browser: the cookie is scoped to Path=/api/auth, so it is only sent to URLs under it.
        if (refreshToken is not null && IsUnderCookiePath(url))
        {
            request.Headers.Add("Cookie", $"{CookieName}={refreshToken}");
        }

        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        return client.SendAsync(request);
    }

    public const string CookiePath = "/api/auth";

    /// <summary>RFC 6265 path-match: exactly the path, or below it.</summary>
    public static bool IsUnderCookiePath(string url)
    {
        var path = url.Split('?')[0];
        return path == CookiePath || path.StartsWith(CookiePath + "/", StringComparison.Ordinal);
    }

    public static string? RefreshSetCookie(HttpResponseMessage response) =>
        response.Headers.TryGetValues("Set-Cookie", out var values)
            ? values.SingleOrDefault(v => v.StartsWith(CookieName + "=", StringComparison.Ordinal))
            : null;

    public static string? CookieValue(string? setCookie)
    {
        if (setCookie is null)
        {
            return null;
        }

        var first = setCookie.Split(';')[0];
        return first[(CookieName.Length + 1)..];
    }

    /// <summary>Lower-cased, trimmed cookie attributes (everything after the name=value pair).</summary>
    public static Dictionary<string, string?> CookieAttributes(string setCookie) =>
        setCookie.Split(';').Skip(1)
            .Select(p => p.Trim())
            .Where(p => p.Length > 0)
            .Select(p => p.Split('=', 2))
            .ToDictionary(p => p[0].ToLowerInvariant(), p => p.Length > 1 ? p[1] : null);

    private static async Task<AuthResponse> ToAuthResponseAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        var body = text.Length == 0 ? default : JsonDocument.Parse(text).RootElement.Clone();
        return new AuthResponse(response, body, RefreshSetCookie(response));
    }
}
