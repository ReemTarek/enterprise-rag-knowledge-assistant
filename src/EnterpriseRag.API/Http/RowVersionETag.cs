using Microsoft.Net.Http.Headers;

namespace EnterpriseRag.API.Http;

/// <summary>
/// Maps a knowledge base's base64 row version to and from HTTP entity tags. The ETag is the strong, quoted row version
/// (<c>"AAAAAAAAB9E="</c>); updates must echo it back in <c>If-Match</c>.
/// </summary>
public static class RowVersionETag
{
    public enum IfMatchResult { Missing, Invalid, Valid }

    public static string Format(string rowVersion) => $"\"{rowVersion}\"";

    /// <summary>
    /// Reads a single strong entity tag carrying a base64 row version. Absent → <see cref="IfMatchResult.Missing"/>;
    /// <c>*</c>, weak tags, lists and non-base64 values → <see cref="IfMatchResult.Invalid"/>.
    /// </summary>
    public static IfMatchResult TryReadIfMatch(HttpRequest request, out string rowVersion)
    {
        rowVersion = string.Empty;
        var raw = request.Headers.IfMatch;
        if (raw.Count == 0 || raw.All(string.IsNullOrWhiteSpace))
        {
            return IfMatchResult.Missing;
        }

        if (!EntityTagHeaderValue.TryParseStrictList(raw, out var tags)
            || tags.Count != 1
            || tags[0].IsWeak
            || tags[0].Equals(EntityTagHeaderValue.Any))
        {
            return IfMatchResult.Invalid;
        }

        var value = tags[0].Tag.Value!.Trim('"');
        Span<byte> buffer = stackalloc byte[64];
        if (value.Length == 0 || !Convert.TryFromBase64String(value, buffer, out _))
        {
            return IfMatchResult.Invalid;
        }

        rowVersion = value;
        return IfMatchResult.Valid;
    }
}
