using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;
using EnterpriseRag.Domain.Identity;
using EnterpriseRag.Infrastructure.Security;
using EnterpriseRag.Infrastructure.Tests.Persistence;
using EnterpriseRag.Shared.Options;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace EnterpriseRag.Infrastructure.Tests.Security;

public sealed class JwtTokenServiceTests
{
    private static readonly DateTime FixedNow = new(2026, 3, 4, 10, 0, 0, DateTimeKind.Utc);

    private static JwtOptions Options(string key = InfrastructureHarness.SigningKey, int minutes = 15, int days = 7) => new()
    {
        Issuer = InfrastructureHarness.Issuer,
        Audience = InfrastructureHarness.Audience,
        SigningKey = key,
        AccessTokenMinutes = minutes,
        RefreshTokenDays = days,
    };

    private static JwtTokenService Service(DateTime now, JwtOptions? options = null) =>
        new(Microsoft.Extensions.Options.Options.Create(options ?? Options()), new FakeDateTimeProvider(now));

    private static User Admin() => User.Create("admin@example.com", "Admin", "hash", GlobalRole.Admin, mustChangePassword: false);

    private static TokenValidationParameters Validation(string key) => new()
    {
        ValidIssuer = InfrastructureHarness.Issuer,
        ValidAudience = InfrastructureHarness.Audience,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
        ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
        ClockSkew = TimeSpan.Zero,
    };

    [Fact]
    public void AccessToken_ContainsSubAndRole_AndExpiresInConfiguredMinutes()
    {
        var user = Admin();
        var token = Service(FixedNow, Options(minutes: 15)).CreateAccessToken(user);

        Assert.Equal(FixedNow.AddMinutes(15), token.ExpiresAtUtc);
        Assert.Equal(DateTimeKind.Utc, token.ExpiresAtUtc.Kind);

        var jwt = new JsonWebTokenHandler().ReadJsonWebToken(token.Value);
        Assert.Equal(user.Id.ToString(), jwt.GetClaim("sub").Value);
        Assert.Equal("Admin", jwt.GetClaim("role").Value);
        Assert.True(Guid.TryParse(jwt.GetClaim("jti").Value, out _));
        Assert.Equal(FixedNow.AddMinutes(15), jwt.ValidTo);
        Assert.Equal(FixedNow, jwt.IssuedAt);
        Assert.Equal(InfrastructureHarness.Issuer, jwt.Issuer);
        Assert.Contains(InfrastructureHarness.Audience, jwt.Audiences);
        Assert.Equal(SecurityAlgorithms.HmacSha256, jwt.Alg);
        Assert.DoesNotContain(jwt.Claims, c => c.Value.Contains("hash", StringComparison.Ordinal));
    }

    [Fact]
    public void AccessToken_EachTokenHasUniqueJti()
    {
        var service = Service(FixedNow);
        var user = Admin();
        var reader = new JsonWebTokenHandler();

        var a = reader.ReadJsonWebToken(service.CreateAccessToken(user).Value).Id;
        var b = reader.ReadJsonWebToken(service.CreateAccessToken(user).Value).Id;

        Assert.NotEqual(a, b);
    }

    [Fact]
    public async Task AccessToken_SignedWithWrongKey_IsRejectedByValidator()
    {
        var token = Service(DateTime.UtcNow).CreateAccessToken(Admin()).Value;
        var handler = new JsonWebTokenHandler();

        var good = await handler.ValidateTokenAsync(token, Validation(InfrastructureHarness.SigningKey));
        var bad = await handler.ValidateTokenAsync(token, Validation("a-completely-different-signing-key-of-32+-bytes"));

        Assert.True(good.IsValid, good.Exception?.Message);
        Assert.False(bad.IsValid);
    }

    [Fact]
    public async Task AccessToken_IsRejected_AfterExpiry()
    {
        var token = Service(DateTime.UtcNow.AddMinutes(-16), Options(minutes: 15)).CreateAccessToken(Admin()).Value;

        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, Validation(InfrastructureHarness.SigningKey));

        Assert.False(result.IsValid);
    }

    [Fact]
    public void RefreshToken_Is64RandomBytes_Base64Url_HashedWithSha256()
    {
        var service = Service(FixedNow, Options(days: 7));

        var issued = service.CreateRefreshToken();
        var other = service.CreateRefreshToken();

        Assert.Equal(64, Base64UrlEncoder.DecodeBytes(issued.Raw).Length);
        Assert.DoesNotContain('+', issued.Raw);
        Assert.DoesNotContain('/', issued.Raw);
        Assert.DoesNotContain('=', issued.Raw);
        Assert.NotEqual(issued.Raw, other.Raw);
        Assert.NotEqual(issued.Raw, issued.Hash);
        Assert.Equal(issued.Hash, service.HashRefreshToken(issued.Raw));
        Assert.Equal(Base64UrlEncoder.Encode(SHA256.HashData(Encoding.UTF8.GetBytes(issued.Raw))), issued.Hash);
        Assert.Equal(FixedNow.AddDays(7), issued.ExpiresAtUtc);
    }

    [Theory]
    [InlineData("too-short-key")]
    [InlineData("exactly-31-bytes-long-key-12345")]
    [InlineData("")]
    public void JwtOptions_ShortSigningKey_FailsValidation(string key)
    {
        using var sp = BuildOptions(key);

        var ex = Assert.Throws<OptionsValidationException>(() => sp.GetRequiredService<IOptions<JwtOptions>>().Value);
        Assert.Contains(nameof(JwtOptions.SigningKey), ex.Message);
    }

    [Fact]
    public void JwtOptions_Valid_HasDefaults()
    {
        using var sp = BuildOptions(InfrastructureHarness.SigningKey);

        var options = sp.GetRequiredService<IOptions<JwtOptions>>().Value;
        Assert.Equal(15, options.AccessTokenMinutes);
        Assert.Equal(7, options.RefreshTokenDays);
    }

    [Fact]
    public void JwtOptions_MissingIssuerOrAudience_FailsValidation()
    {
        var options = Options();
        options.Issuer = "";
        options.Audience = "";

        var results = new List<ValidationResult>();
        Assert.False(Validator.TryValidateObject(options, new ValidationContext(options), results, validateAllProperties: true));
        Assert.Contains(results, r => r.MemberNames.Contains(nameof(JwtOptions.Issuer)));
        Assert.Contains(results, r => r.MemberNames.Contains(nameof(JwtOptions.Audience)));
    }

    private static ServiceProvider BuildOptions(string key)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Jwt:Issuer"] = InfrastructureHarness.Issuer,
            ["Jwt:Audience"] = InfrastructureHarness.Audience,
            ["Jwt:SigningKey"] = key,
        }).Build();
        var services = new ServiceCollection();
        services.AddValidatedOptions<JwtOptions>(configuration, JwtOptions.SectionName);
        return services.BuildServiceProvider();
    }
}
