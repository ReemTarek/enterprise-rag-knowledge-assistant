using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace EnterpriseRag.API.Http;

/// <summary>
/// Stable <c>type</c> URIs for every ProblemDetails the API emits. Clients branch on <c>type</c> (not on <c>title</c> or
/// <c>detail</c>), e.g. to tell "change your password first" apart from an ordinary 403. The URIs identify the problem
/// kind; they are not required to resolve.
/// </summary>
public static class ProblemTypes
{
    public const string Base = "https://enterprise-rag.local/problems/";

    public const string Validation = Base + "validation";
    public const string BadRequest = Base + "bad-request";
    public const string BusinessRule = Base + "business-rule";
    public const string Unauthorized = Base + "unauthorized";
    public const string Forbidden = Base + "forbidden";
    public const string PasswordChangeRequired = Base + "password-change-required";
    public const string NotFound = Base + "not-found";
    public const string Conflict = Base + "conflict";
    public const string PreconditionFailed = Base + "precondition-failed";
    public const string PreconditionRequired = Base + "precondition-required";
    public const string TooManyRequests = Base + "too-many-requests";
    public const string InternalError = Base + "internal-error";

    /// <summary>The default type for a status code; codes without a dedicated kind get <c>.../http-{status}</c>.</summary>
    public static string ForStatus(int status) => status switch
    {
        StatusCodes.Status400BadRequest => BadRequest,
        StatusCodes.Status401Unauthorized => Unauthorized,
        StatusCodes.Status403Forbidden => Forbidden,
        StatusCodes.Status404NotFound => NotFound,
        StatusCodes.Status409Conflict => Conflict,
        StatusCodes.Status412PreconditionFailed => PreconditionFailed,
        StatusCodes.Status428PreconditionRequired => PreconditionRequired,
        StatusCodes.Status429TooManyRequests => TooManyRequests,
        StatusCodes.Status500InternalServerError => InternalError,
        _ => Base + "http-" + status.ToString(System.Globalization.CultureInfo.InvariantCulture),
    };

    /// <summary>
    /// Keeps a type already chosen from this scheme; otherwise (null, or a framework default such as an RFC 9110 link)
    /// derives it: validation bodies get <see cref="Validation"/>, everything else <see cref="ForStatus"/>.
    /// </summary>
    public static string Resolve(ProblemDetails problem)
    {
        if (problem.Type is not null && problem.Type.StartsWith(Base, StringComparison.Ordinal))
        {
            return problem.Type;
        }

        if (problem is HttpValidationProblemDetails)
        {
            return Validation;
        }

        return ForStatus(problem.Status ?? StatusCodes.Status500InternalServerError);
    }
}
