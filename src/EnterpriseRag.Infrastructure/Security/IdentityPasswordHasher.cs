using System.Security.Cryptography;
using EnterpriseRag.Shared.Options;
using Microsoft.AspNetCore.Identity;
using AppPasswordHasher = EnterpriseRag.Application.Abstractions.IPasswordHasher;

namespace EnterpriseRag.Infrastructure.Security;

/// <summary>
/// ASP.NET Core Identity's PBKDF2 hasher (V3 format: HMAC-SHA512, random salt, iteration count in the hash).
/// </summary>
public sealed class IdentityPasswordHasher(SecurityOptions security) : AppPasswordHasher
{
    public const int MinGeneratedLength = 20;

    // No look-alike characters (0/O/o, 1/l/I, |) so temporary passwords can be read out or retyped safely.
    private const string Upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    private const string Lower = "abcdefghijkmnpqrstuvwxyz";
    private const string Digits = "23456789";
    private const string Symbols = "!@#$%^&*-_=+?";
    private const string All = Upper + Lower + Digits + Symbols;

    // The user argument is unused by the V3 algorithm; one marker instance serves every call.
    private static readonly object HashSubject = new();
    private readonly PasswordHasher<object> _inner = new();

    public string Hash(string password) => _inner.HashPassword(HashSubject, password);

    /// <summary>
    /// Returns false (never throws) for a wrong password or an empty/malformed hash, so callers such as the login
    /// handler's dummy-hash timing path behave uniformly.
    /// </summary>
    public bool Verify(string hash, string password)
    {
        if (string.IsNullOrEmpty(hash))
        {
            return false;
        }

        try
        {
            return _inner.VerifyHashedPassword(HashSubject, hash, password ?? string.Empty) != PasswordVerificationResult.Failed;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    public string GenerateTemporaryPassword()
    {
        var length = Math.Max(MinGeneratedLength, security.MinPasswordLength);
        var chars = new char[length];
        chars[0] = Pick(Upper);
        chars[1] = Pick(Lower);
        chars[2] = Pick(Digits);
        chars[3] = Pick(Symbols);
        for (var i = 4; i < length; i++)
        {
            chars[i] = Pick(All);
        }

        RandomNumberGenerator.Shuffle(chars.AsSpan());
        return new string(chars);
    }

    private static char Pick(string alphabet) => alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];
}
