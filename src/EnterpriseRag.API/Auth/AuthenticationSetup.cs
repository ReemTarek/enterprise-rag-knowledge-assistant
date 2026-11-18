using System.Text;
using System.Threading.RateLimiting;
using EnterpriseRag.Shared.Options;
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

    public const int LoginPermitsPerMinute = 10;
    public const int RefreshPermitsPerMinute = 30;

    public const string SubjectClaim = "sub";
    public const string RoleClaim = "role";

    /// <summary>
    /// JWT bearer validation (issuer, audience, HS256 signature, lifetime with 30 s skew), an active-user check on every
    /// request, a fallback policy that requires authentication everywhere (opt out with <c>AllowAnonymous</c>), and the
    /// <see cref="AdminOnlyPolicy"/>.
    /// </summary>
    public static IServiceCollection AddApiAuthentication(this IServiceCollection services)
    {
        services.AddScoped<ActiveUserCheck>();
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
                        var check = context.HttpContext.RequestServices.GetRequiredService<ActiveUserCheck>();
                        if (!Guid.TryParse(subject, out var userId)
                            || !await check.IsActiveAsync(userId, context.HttpContext.RequestAborted))
                        {
                            context.Fail("The user is unknown, inactive or deleted.");
                        }
                    },
                    OnChallenge = async context =>
                    {
                        context.HandleResponse();
                        context.Response.Headers.WWWAuthenticate = JwtBearerDefaults.AuthenticationScheme;
                        await ProblemResponses.WriteAsync(context.HttpContext, StatusCodes.Status401Unauthorized,
                            "Unauthorized", "Authentication is required.");
                    },
                    OnForbidden = context => ProblemResponses.WriteAsync(context.HttpContext, StatusCodes.Status403Forbidden,
                        "Forbidden", "Access denied."),
                };
            });

        services.AddAuthorizationBuilder()
            .SetFallbackPolicy(new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder()
                .RequireAuthenticatedUser()
                .Build())
            .AddPolicy(AdminOnlyPolicy, policy => policy.RequireAuthenticatedUser().RequireClaim(RoleClaim, "Admin"));

        return services;
    }

    /// <summary>
    /// Fixed-window limits per client IP for the anonymous token endpoints. The partition key is
    /// <c>Connection.RemoteIpAddress</c>; behind a reverse proxy this must be fed by ForwardedHeaders with a trusted
    /// proxy list (Phase 11) — never by reading X-Forwarded-For directly, which a client can forge.
    /// </summary>
    public static IServiceCollection AddApiRateLimiting(this IServiceCollection services)
    {
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(LoginRateLimitPolicy, context => PerIp(context, LoginPermitsPerMinute));
            options.AddPolicy(RefreshRateLimitPolicy, context => PerIp(context, RefreshPermitsPerMinute));
            options.OnRejected = async (context, _) =>
            {
                if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
                {
                    context.HttpContext.Response.Headers.RetryAfter = ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(
                        System.Globalization.CultureInfo.InvariantCulture);
                }

                await ProblemResponses.WriteAsync(context.HttpContext, StatusCodes.Status429TooManyRequests,
                    "Too many requests", "Too many attempts. Try again later.");
            };
        });
        return services;
    }

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
