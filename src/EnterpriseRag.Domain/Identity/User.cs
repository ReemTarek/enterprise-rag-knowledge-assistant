using EnterpriseRag.Domain.Common;

namespace EnterpriseRag.Domain.Identity;

public class User : SoftDeletableEntity
{
    private User()
    {
    }

    public string Email { get; private set; } = string.Empty;

    public string DisplayName { get; private set; } = string.Empty;

    public string PasswordHash { get; private set; } = string.Empty;

    public GlobalRole GlobalRole { get; private set; }

    public bool IsActive { get; private set; } = true;

    public bool MustChangePassword { get; private set; }

    public int FailedLoginCount { get; private set; }

    public DateTime? LockoutEndUtc { get; private set; }

    public static User Create(string email, string displayName, string passwordHash, GlobalRole role, bool mustChangePassword)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            throw new DomainException("Email is required.");
        }

        if (string.IsNullOrWhiteSpace(displayName))
        {
            throw new DomainException("Display name is required.");
        }

        return new User
        {
            Email = email.Trim().ToLowerInvariant(),
            DisplayName = displayName.Trim(),
            PasswordHash = passwordHash,
            GlobalRole = role,
            MustChangePassword = mustChangePassword,
        };
    }

    /// <summary>
    /// Increments the failed-login counter. When it reaches <paramref name="maxAttempts"/> the account is locked
    /// until <paramref name="utcNow"/> + <paramref name="lockout"/> and the counter resets to 0.
    /// </summary>
    public void RegisterFailedLogin(DateTime utcNow, int maxAttempts, TimeSpan lockout)
    {
        if (utcNow.Kind != DateTimeKind.Utc)
        {
            throw new DomainException("Login timestamp must be in UTC.");
        }

        FailedLoginCount++;
        if (FailedLoginCount >= maxAttempts)
        {
            LockoutEndUtc = utcNow + lockout;
            FailedLoginCount = 0;
        }
    }

    public void RegisterSuccessfulLogin()
    {
        FailedLoginCount = 0;
        LockoutEndUtc = null;
    }

    public bool IsLockedOut(DateTime utcNow)
    {
        if (utcNow.Kind != DateTimeKind.Utc)
        {
            throw new DomainException("Timestamp must be in UTC.");
        }

        return LockoutEndUtc > utcNow;
    }

    public void Deactivate() => IsActive = false;

    public void SetPassword(string passwordHash, bool mustChange)
    {
        PasswordHash = passwordHash;
        MustChangePassword = mustChange;
    }
}
