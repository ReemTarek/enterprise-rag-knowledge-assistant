using System.Security.Claims;
using EnterpriseRag.API.Http;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;

namespace EnterpriseRag.API.Auth;

/// <summary>
/// The server-added claim that marks a principal whose stored user must change their password. It is derived from SQL
/// on every request (<see cref="ActiveUserCheck"/>); any claim of this type that arrived inside the token is removed
/// first, so a token can neither impose nor lift the block.
/// </summary>
public static class PasswordChangeClaims
{
    public const string ClaimType = "must_change_password";

    /// <summary>Issuer stamped on the server-added claim; token claims carry the JWT issuer instead.</summary>
    public const string ServerIssuer = "enterprise-rag:server";

    public static void Apply(ClaimsPrincipal principal, bool mustChangePassword)
    {
        foreach (var identity in principal.Identities)
        {
            foreach (var claim in identity.FindAll(ClaimType).ToList())
            {
                identity.TryRemoveClaim(claim);
            }
        }

        if (mustChangePassword && principal.Identity is ClaimsIdentity primary)
        {
            primary.AddClaim(new Claim(ClaimType, "true", ClaimValueTypes.Boolean, ServerIssuer));
        }
    }

    public static bool IsRequired(ClaimsPrincipal user) =>
        user.HasClaim(c => c.Type == ClaimType && c.Value == "true" && c.Issuer == ServerIssuer);
}

/// <summary>
/// Satisfied unless the user must change their password and the endpoint is not marked
/// <see cref="AllowWhilePasswordChangeRequiredAttribute"/>. Part of the default, fallback and AdminOnly policies, so
/// every authenticated endpoint is blocked by default (deny-by-default; anonymous endpoints never evaluate policies).
/// </summary>
public sealed class PasswordChangeRequiredRequirement : IAuthorizationRequirement
{
    public static readonly PasswordChangeRequiredRequirement Instance = new();
}

public sealed class PasswordChangeRequiredAuthorizationHandler : AuthorizationHandler<PasswordChangeRequiredRequirement>
{
    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, PasswordChangeRequiredRequirement requirement)
    {
        // Not calling Fail(): an unmet requirement stays in FailedRequirements, which the result handler inspects.
        if (!PasswordChangeClaims.IsRequired(context.User) || IsAllowlisted(context.Resource))
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }

    private static bool IsAllowlisted(object? resource)
    {
        var endpoint = resource switch
        {
            HttpContext http => http.GetEndpoint(),
            Endpoint e => e,
            _ => null,
        };
        return endpoint?.Metadata.GetMetadata<AllowWhilePasswordChangeRequiredAttribute>() is not null;
    }
}

/// <summary>
/// Turns a forbidden result caused by <see cref="PasswordChangeRequiredRequirement"/> into a 403 ProblemDetails with
/// <see cref="ProblemTypes.PasswordChangeRequired"/>; every other outcome goes to the default handler (challenge → 401,
/// other forbids → 403 <see cref="ProblemTypes.Forbidden"/> via JwtBearer <c>OnForbidden</c>). When a must-change user
/// also lacks a role (e.g. a non-admin on an admin route), the password-change problem wins: it is what they must fix first.
/// </summary>
public sealed class ProblemAuthorizationResultHandler : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler _default = new();

    public Task HandleAsync(RequestDelegate next, HttpContext context, AuthorizationPolicy policy, PolicyAuthorizationResult authorizeResult)
    {
        if (authorizeResult.Forbidden
            && authorizeResult.AuthorizationFailure?.FailedRequirements.OfType<PasswordChangeRequiredRequirement>().Any() == true)
        {
            return ProblemResponses.WriteAsync(context, StatusCodes.Status403Forbidden, "Password change required",
                "You must change your password before using this endpoint (POST /api/auth/password).",
                ProblemTypes.PasswordChangeRequired);
        }

        return _default.HandleAsync(next, context, policy, authorizeResult);
    }
}
