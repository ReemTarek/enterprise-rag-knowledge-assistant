using EnterpriseRag.Infrastructure.Security;
using EnterpriseRag.Shared.Options;

namespace EnterpriseRag.Infrastructure.Tests.Security;

public sealed class PasswordHasherTests
{
    private const string Ambiguous = "0Oo1lI|";
    private const string Symbols = "!@#$%^&*-_=+?";

    private static readonly IdentityPasswordHasher Hasher = new(new SecurityOptions());

    [Fact]
    public void PasswordHasher_Verify_RoundTrips_AndRejectsWrong()
    {
        var hash = Hasher.Hash("Correct-Horse-9");

        Assert.NotEqual("Correct-Horse-9", hash);
        Assert.DoesNotContain("Correct-Horse-9", hash);
        Assert.True(Hasher.Verify(hash, "Correct-Horse-9"));
        Assert.False(Hasher.Verify(hash, "correct-horse-9"));
        Assert.False(Hasher.Verify(hash, string.Empty));
    }

    [Fact]
    public void PasswordHasher_SamePassword_ProducesDifferentSaltedHashes()
    {
        Assert.NotEqual(Hasher.Hash("Same-Password-1"), Hasher.Hash("Same-Password-1"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-valid-hash")]
    [InlineData("AQ==")]
    public void PasswordHasher_Verify_MalformedOrEmptyHash_ReturnsFalse_WithoutThrowing(string hash)
    {
        Assert.False(Hasher.Verify(hash, "Whatever-Pass-1"));
    }

    [Fact]
    public void PasswordHasher_Verify_DummyHash_RejectsArbitraryPassword()
    {
        // LoginHandler burns a verification against a hash of a random value for unknown accounts.
        var dummy = Hasher.Hash(Guid.NewGuid().ToString("N"));

        Assert.False(Hasher.Verify(dummy, "Admin-Password-1"));
    }

    [Fact]
    public void GeneratedTemporaryPassword_MeetsComplexity_And_IsRandom()
    {
        var generated = Enumerable.Range(0, 200).Select(_ => Hasher.GenerateTemporaryPassword()).ToList();

        Assert.Equal(generated.Count, generated.Distinct().Count());
        foreach (var password in generated)
        {
            Assert.True(password.Length >= 16, password);
            Assert.True(password.Length >= new SecurityOptions().MinPasswordLength, password);
            Assert.Contains(password, char.IsUpper);
            Assert.Contains(password, char.IsLower);
            Assert.Contains(password, char.IsDigit);
            Assert.Contains(password, c => Symbols.Contains(c));
            Assert.DoesNotContain(password, c => Ambiguous.Contains(c));
            Assert.All(password, c => Assert.True(c is > ' ' and < (char)127, password));
        }
    }

    [Fact]
    public void GeneratedTemporaryPassword_RespectsLongerConfiguredMinimum()
    {
        var hasher = new IdentityPasswordHasher(new SecurityOptions { MinPasswordLength = 40 });

        Assert.True(hasher.GenerateTemporaryPassword().Length >= 40);
    }
}
