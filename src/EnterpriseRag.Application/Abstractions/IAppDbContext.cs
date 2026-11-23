using EnterpriseRag.Domain.Audit;
using EnterpriseRag.Domain.Identity;
using EnterpriseRag.Domain.KnowledgeBases;

namespace EnterpriseRag.Application.Abstractions;

/// <summary>
/// Narrow persistence port. Implemented by the EF Core <c>AppDbContext</c> in Infrastructure; Application never sees EF types.
/// Queries are executed through <see cref="IAsyncQueryExecutor"/>. Entities returned by queries are tracked, so mutating
/// them and calling <see cref="SaveChangesAsync"/> persists the change.
/// </summary>
public interface IAppDbContext
{
    IQueryable<User> Users { get; }

    /// <summary>Knowledge-base aggregates; implementations must load <see cref="KnowledgeBase.Members"/>.</summary>
    IQueryable<KnowledgeBase> KnowledgeBases { get; }

    IQueryable<RefreshToken> RefreshTokens { get; }

    IQueryable<AuditLog> AuditLogs { get; }

    void Add<T>(T entity) where T : class;

    /// <summary>
    /// Declares the row version the client last saw (If-Match) for optimistic concurrency. On a mismatch with the loaded
    /// entity the implementation throws <see cref="Common.ConcurrencyConflictException"/> immediately - even when the
    /// request changes nothing - and also when the row changes between load and <see cref="SaveChangesAsync"/>.
    /// Concurrency failures on entities without a declared row version are plain <see cref="Common.ConflictException"/>s.
    /// </summary>
    void SetExpectedRowVersion(KnowledgeBase knowledgeBase, byte[] rowVersion);

    /// <summary>
    /// Persists tracked changes. Implementations MUST throw <see cref="Common.ConflictException"/> (never a provider
    /// exception) when an optimistic-concurrency check fails — including a <see cref="RefreshToken"/> rotation race,
    /// where two requests revoke the same still-active token (e.g. via a concurrency token or a conditional
    /// <c>UPDATE ... WHERE RevokedAt IS NULL</c> that must affect exactly one row). After throwing, the failed changes
    /// must not be re-sent by the next save (e.g. detach/reload them), so a follow-up save — such as the refresh
    /// handler revoking the token family — can succeed. The EF implementation does this with
    /// <c>ChangeTracker.Clear()</c>: after a conflict (409 or 412) ALL tracked entities are detached, not only the
    /// failed ones, so a handler that catches the exception must re-query anything it still needs.
    /// </summary>
    Task<int> SaveChangesAsync(CancellationToken cancellationToken);
}
