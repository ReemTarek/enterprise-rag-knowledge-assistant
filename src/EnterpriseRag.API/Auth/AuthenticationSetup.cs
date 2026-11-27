using System.Text;
using System.Threading.RateLimiting;
using EnterpriseRag.API.Http;
using EnterpriseRag.Shared.Options;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace EnterpriseRag.API.Auth;

public static class AuthenticationSetup
{
    public const string AdminOnlyPolicy = "AdminOnly";
    public const string LoginRateLimitPolicy = "login";
    public const string RefreshRateLimitPolicy = "refresh";

    public const string SubjectClaim = "sub";
    public const string RoleClaim = "role";

    /// <summary>
    /// JWT bearer validation (issuer, audience, HS256 signature, lifetime with 30 s skew), an active-user check on every
    /// request, a fallback policy that requires authentication everywhere (opt out with <c>AllowAnonymous</c>), and the
    /// <see cref="AdminOnlyPolicy"/>. The default, fallback and AdminOnly policies all carry
    /// <see cref="PasswordChangeRequiredRequirement"/>: a user whose stored <c>MustChangePassword</c> is true gets a 403
    /// <see cref="ProblemTypes.PasswordChangeRequired"/> everywhere except endpoints marked
    /// <see cref="AllowWhilePasswordChangeRequiredAttribute"/>. Any policy added later must include it too (the
    /// endpoint-walk test fails otherwise).
    /// </summary>
    public static IServiceCollection AddApiAuthentication(this IServiceCollection services)
    {
        services.AddScoped<ActiveUserCheck>();
        services.AddSingleton<IAuthorizationHandler, PasswordChangeRequiredAuthorizationHandler>();
        services.AddSingleton<IAuthorizationMiddlewareResultHandler, ProblemAuthorizationResultHandler>();
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();

        // Configured from the validated JwtOptions at resolve time (not from IConfiguration at startup), so the key is
        // exactly the one JwtTokenService signs with: the UTF-8 bytes of Jwt:SigningKey.
        services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
            .Configure<IOptions<JwtOptions>>((options, jwtOptions) =>
            {
                var jwt = jwtOptions.Value;
                options.MapInboundClaims = false;
                options.IncludeErrorDetails = false;
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidIssuer = jwt.Issuer,
                    ValidateAudience = true,
                    ValidAudience = jwt.Audience,
                    ValidateLifetime = true,
                    RequireExpirationTime = true,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SigningKey)),
                    ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                    ClockSkew = TimeSpan.FromSeconds(30),
                    NameClaimType = SubjectClaim,
                    RoleClaimType = RoleClaim,
                };
                options.Events = new JwtBearerEvents
                {
                    OnTokenValidated = async context =>
                    {
                        var subject = context.Principal?.FindFirst(SubjectClaim)?.Value;
                        var roles = context.Principal?.FindAll(RoleClaim).Select(c => c.Value).ToList() ?? [];
                        var check = context.HttpContext.RequestServices.GetRequiredService<ActiveUserCheck>();
                        // Fail closed: exactly one role claim, and it must match the stored role.
                        var status = Guid.TryParse(subject, out var userId) && roles.Count == 1
                            ? await check.CheckAsync(userId, roles[0], context.HttpContext.RequestAborted)
                            : null;
                        if (status is null)
                        {
                            context.Fail("The user is unknown, inactive, deleted or no longer holds the token's role.");
                            return;
                        }

                        // Server-added from SQL; a same-named claim inside the token is stripped first.
                        PasswordChangeClaims.Apply(context.Principal!, status.MustChangePassword);
                    },
                    OnChallenge = async context =>
                    {
                        context.HandleResponse();
                        context.Response.Headers.WWWAuthenticate = JwtBearerDefaults.AuthenticationScheme;
                        await ProblemResponses.WriteAsync(context.HttpContext, StatusCodes.Status401Unauthorized,
                            "Unauthorized", "Authentication is required.", ProblemTypes.Unauthorized);
                    },
                    OnForbidden = context => ProblemResponses.WriteAsync(context.HttpContext, StatusCodes.Status403Forbidden,
                        "Forbidden", "Access denied.", ProblemTypes.Forbidden),
                };
            });

        // The fallback policy only applies to endpoints WITHOUT authorization metadata, so the requirement must be on
        // the default policy ([Authorize]) and on every named policy as well.
        var authenticated = new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .AddRequirements(PasswordChangeRequiredRequirement.Instance)
            .Build();
        services.AddAuthorizationBuilder()
            .SetDefaultPolicy(authenticated)
            .SetFallbackPolicy(authenticated)
            .AddPolicy(AdminOnlyPolicy, policy => policy
                .RequireAuthenticatedUser()
                .RequireClaim(RoleClaim, "Admin")
                .AddRequirements(PasswordChangeRequiredRequirement.Instance));

        return services;
    }

    /// <summary>
    /// Fixed-window limits per client IP for the anonymous token endpoints. The partition key is
    /// <c>Connection.RemoteIpAddress</c>; behind a reverse proxy this must be fed by ForwardedHeaders with a trusted
    /// proxy list (Phase 11) — never by reading X-Forwarded-For directly, which a client can forge. Permits per minute come
    /// from the validated <see cref="RateLimitOptions"/> (registered in Program.cs; production defaults 10 and 30).
    /// </summary>
    public static IServiceCollection AddApiRateLimiting(this IServiceCollection services)
    {
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(LoginRateLimitPolicy, context => PerIp(context, Limits(context).LoginPermitsPerMinute));
            options.AddPolicy(RefreshRateLimitPolicy, context => PerIp(context, Limits(context).RefreshPermitsPerMinute));
            options.OnRejected = async (context, _) =>
            {
                if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
                {
                    context.HttpContext.Response.Headers.RetryAfter = ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(
                        System.Globalization.CultureInfo.InvariantCulture);
                }

                await ProblemResponses.WriteAsync(context.HttpContext, StatusCodes.Status429TooManyRequests,
                    "Too many requests", "Too many attempts. Try again later.", ProblemTypes.TooManyRequests);
            };
        });
        return services;
    }

    /// <summary>The validated <see cref="RateLimitOptions"/> (section <c>RateLimit</c>; defaults 10 and 30 per minute).</summary>
    private static RateLimitOptions Limits(HttpContext context) =>
        context.RequestServices.GetRequiredService<IOptions<RateLimitOptions>>().Value;

    private static RateLimitPartition<string> PerIp(HttpContext context, int permitsPerMinute) =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permitsPerMinute,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true,
            });
}
