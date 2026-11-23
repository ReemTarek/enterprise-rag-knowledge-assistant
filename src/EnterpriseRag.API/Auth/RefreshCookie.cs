namespace EnterpriseRag.API.Auth;

/// <summary>
/// The refresh token travels only in this cookie: HttpOnly (no script access), Secure, SameSite=Strict and scoped to
/// <c>/api/auth</c> so browsers send it to the login/refresh/logout endpoints and nowhere else. It is never put in a
/// response body.
/// </summary>
public static class RefreshCookie
{
    public const string Name = "refresh_token";
    public const string Path = "/api/auth";

    public static void Append(HttpResponse response, string refreshToken, DateTime expiresAtUtc) =>
        response.Cookies.Append(Name, refreshToken, Options(new DateTimeOffset(DateTime.SpecifyKind(expiresAtUtc, DateTimeKind.Utc))));

    public static void Delete(HttpResponse response) => response.Cookies.Delete(Name, Options(expires: null));

    public static string? Read(HttpRequest request) =>
        request.Cookies.TryGetValue(Name, out var value) && !string.IsNullOrWhiteSpace(value) ? value : null;

    private static CookieOptions Options(DateTimeOffset? expires) => new()
    {
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.Strict,
        Path = Path,
        Expires = expires,
        IsEssential = true,
    };
}
