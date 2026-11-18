namespace EnterpriseRag.Application.Abstractions;

public interface IPasswordHasher
{
    string Hash(string password);

    bool Verify(string hash, string password);

    /// <summary>Returns a random password that satisfies the password policy (length, upper, lower, digit).</summary>
    string GenerateTemporaryPassword();
}
