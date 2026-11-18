namespace EnterpriseRag.Application.Common;

/// <summary>The request conflicts with current state (duplicate, last owner, stale row version, ...). Maps to HTTP 409.</summary>
public sealed class ConflictException(string message) : Exception(message);

public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount);

public static class Paging
{
    public const int DefaultPageSize = 20;
    public const int MaxPageSize = 100;

    /// <summary>Normalizes paging input: page ≥ 1; page size defaults to 20 when &lt; 1 and is capped at 100.</summary>
    public static (int Page, int PageSize, int Skip) Normalize(int page, int pageSize)
    {
        var p = Math.Max(1, page);
        var size = pageSize < 1 ? DefaultPageSize : Math.Min(pageSize, MaxPageSize);
        return (p, size, (p - 1) * size);
    }
}

/// <summary>Audit action names. Entries never carry passwords, tokens or hashes.</summary>
public static class AuditActions
{
    public const string LoginSucceeded = "auth.login.succeeded";
    public const string LoginFailed = "auth.login.failed";
    public const string TokenRefreshed = "auth.token.refreshed";
    public const string RefreshTokenReuseDetected = "auth.token.reuse_detected";
    public const string Logout = "auth.logout";
    public const string PasswordChanged = "user.password.changed";
    public const string UserCreated = "user.created";
    public const string UserDeactivated = "user.deactivated";
    public const string PasswordReset = "user.password.reset";
    public const string KnowledgeBaseCreated = "kb.created";
    public const string KnowledgeBaseUpdated = "kb.updated";
    public const string KnowledgeBaseDeleted = "kb.deleted";
    public const string MemberAdded = "kb.member.added";
    public const string MemberRoleChanged = "kb.member.role_changed";
    public const string MemberRemoved = "kb.member.removed";
}

public static class AuditTargets
{
    public const string User = "User";
    public const string KnowledgeBase = "KnowledgeBase";
}
