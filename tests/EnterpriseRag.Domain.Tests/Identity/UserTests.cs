using EnterpriseRag.Domain.Common;
using EnterpriseRag.Domain.Identity;

namespace EnterpriseRag.Domain.Tests.Identity;

public class UserTests
{
    private static readonly DateTime Now = new(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);

    private static User NewUser() => User.Create("  Foo@Example.COM ", "Foo", "hash", GlobalRole.User, false);

    [Fact]
    public void User_Create_NormalizesEmailToLowerCase()
    {
        var user = NewUser();

        Assert.Equal("foo@example.com", user.Email);
        Assert.True(user.IsActive);
    }

    [Fact]
    public void User_FiveFailedLogins_LocksOutUntilEnd()
    {
        var user = NewUser();
        var lockout = TimeSpan.FromMinutes(15);

        for (var i = 0; i < 4; i++)
        {
            user.RegisterFailedLogin(Now, 5, lockout);
        }

        Assert.False(user.IsLockedOut(Now));

        user.RegisterFailedLogin(Now, 5, lockout);

        Assert.True(user.IsLockedOut(Now));
        Assert.Equal(Now + lockout, user.LockoutEndUtc);
        Assert.False(user.IsLockedOut(Now + lockout));
    }

    [Fact]
    public void User_SuccessfulLogin_ResetsFailedCount()
    {
        var user = NewUser();
        user.RegisterFailedLogin(Now, 5, TimeSpan.FromMinutes(1));
        user.RegisterFailedLogin(Now, 5, TimeSpan.FromMinutes(1));

        user.RegisterSuccessfulLogin();

        Assert.Equal(0, user.FailedLoginCount);
        Assert.Null(user.LockoutEndUtc);
    }

    [Fact]
    public void User_Create_EmptyEmail_Throws() =>
        Assert.Throws<DomainException>(() => User.Create(" ", "Foo", "hash", GlobalRole.User, false));
}
