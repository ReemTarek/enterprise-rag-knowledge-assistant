using System.Text.Json;
using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Application.Common;
using EnterpriseRag.Domain.Audit;
using EnterpriseRag.Domain.Identity;
using EnterpriseRag.Domain.KnowledgeBases;

namespace EnterpriseRag.Application.Tests.Fakes;

public sealed class FakeClock(DateTime utcNow) : IDateTimeProvider
{
    public DateTime UtcNow { get; private set; } = utcNow;

    public void Advance(TimeSpan by) => UtcNow += by;
}

public sealed class FakeCurrentUser : ICurrentUserService
{
    public Guid? UserGuid { get; private set; }

    public bool IsAdmin { get; private set; }

    public string? UserId => UserGuid?.ToString();

    public void Set(Guid? userId, bool isAdmin)
    {
        UserGuid = userId;
        IsAdmin = isAdmin;
    }
}

/// <summary>LINQ-to-objects stand-in for the EF Core backed persistence port.</summary>
public sealed class InMemoryAppDbContext : IAppDbContext
{
    private readonly List<User> _users = [];
    private readonly List<KnowledgeBase> _knowledgeBases = [];
    private readonly List<RefreshToken> _refreshTokens = [];
    private readonly List<AuditLog> _auditLogs = [];

    public IQueryable<User> Users => _users.AsQueryable();

    public IQueryable<KnowledgeBase> KnowledgeBases => _knowledgeBases.AsQueryable();

    public IQueryable<RefreshToken> RefreshTokens => _refreshTokens.AsQueryable();

    public IQueryable<AuditLog> AuditLogs => _auditLogs.AsQueryable();

    /// <summary>Successful saves only.</summary>
    public int SaveCount { get; private set; }

    /// <summary>Exceptions thrown by the next saves, in order (simulates optimistic-concurrency failures).</summary>
    public Queue<Exception> SaveFailures { get; } = new();

    public void Add<T>(T entity) where T : class
    {
        switch (entity)
        {
            case User u: _users.Add(u); break;
            case KnowledgeBase kb: _knowledgeBases.Add(kb); break;
            case RefreshToken t: _refreshTokens.Add(t); break;
            case AuditLog a: _auditLogs.Add(a); break;
            default: throw new NotSupportedException(typeof(T).Name);
        }
    }

    public void SetExpectedRowVersion(KnowledgeBase knowledgeBase, byte[] rowVersion)
    {
        if (!knowledgeBase.RowVersion.AsSpan().SequenceEqual(rowVersion))
        {
            throw new ConcurrencyConflictException("The knowledge base was modified by someone else.");
        }
    }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        if (SaveFailures.TryDequeue(out var failure))
        {
            throw failure;
        }

        SaveCount++;
        return Task.FromResult(1);
    }
}

public sealed class InMemoryQueryExecutor : IAsyncQueryExecutor
{
    public Task<List<T>> ToListAsync<T>(IQueryable<T> query, CancellationToken cancellationToken) =>
        Task.FromResult(query.ToList());

    public Task<T?> FirstOrDefaultAsync<T>(IQueryable<T> query, CancellationToken cancellationToken) =>
        Task.FromResult(query.FirstOrDefault());

    public Task<bool> AnyAsync<T>(IQueryable<T> query, CancellationToken cancellationToken) =>
        Task.FromResult(query.Any());

    public Task<int> CountAsync<T>(IQueryable<T> query, CancellationToken cancellationToken) =>
        Task.FromResult(query.Count());
}

public sealed class FakePasswordHasher : IPasswordHasher
{
    private int _generated;

    public int VerifyCount { get; private set; }

    public string Hash(string password) => "hashed:" + password;

    public bool Verify(string hash, string password)
    {
        VerifyCount++;
        return hash == "hashed:" + password;
    }

    public string GenerateTemporaryPassword() => $"Temp-Pass-{++_generated:D4}-Xy9";
}

public sealed class FakeTokenService(IDateTimeProvider clock) : ITokenService
{
    private int _issued;

    public AccessToken CreateAccessToken(User user) =>
        new($"access-{user.Id}-{++_issued}", clock.UtcNow.AddMinutes(15));

    public RefreshTokenIssue CreateRefreshToken()
    {
        var raw = $"refresh-{++_issued}";
        return new RefreshTokenIssue(raw, HashRefreshToken(raw), clock.UtcNow.AddDays(7));
    }

    public string HashRefreshToken(string raw) => "sha:" + raw;
}

public sealed record AuditEntry(string Action, string? TargetType, string? TargetId, string? DetailsJson);

public sealed class FakeAuditLogger : IAuditLogger
{
    public List<AuditEntry> Entries { get; } = [];

    public Task LogAsync(string action, string? targetType, string? targetId, object? details, CancellationToken cancellationToken)
    {
        Entries.Add(new AuditEntry(action, targetType, targetId, details is null ? null : JsonSerializer.Serialize(details)));
        return Task.CompletedTask;
    }
}
