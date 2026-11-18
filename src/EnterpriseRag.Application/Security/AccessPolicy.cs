using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Domain.KnowledgeBases;

namespace EnterpriseRag.Application.Security;

/// <summary>Central knowledge-base authorization. Every KB handler goes through it.</summary>
public interface IAccessPolicy
{
    /// <summary>
    /// Loads the knowledge base if the caller is a member with at least <paramref name="minimum"/>.
    /// Missing, soft-deleted and non-member all throw the identical <see cref="NotFoundException"/>;
    /// a member with a lower role gets <see cref="AccessDeniedException"/>. Global Admin gets no special access.
    /// </summary>
    Task<KnowledgeBase> RequireKnowledgeBaseAsync(Guid kbId, KnowledgeBaseRole minimum, CancellationToken ct);

    Task<IReadOnlyList<Guid>> AccessibleKnowledgeBaseIdsAsync(CancellationToken ct);
}

public sealed class AccessPolicy(IAppDbContext db, IAsyncQueryExecutor query, ICurrentUserService currentUser) : IAccessPolicy
{
    public async Task<KnowledgeBase> RequireKnowledgeBaseAsync(Guid kbId, KnowledgeBaseRole minimum, CancellationToken ct)
    {
        var userId = currentUser.RequireUserId();
        var kb = await query.FirstOrDefaultAsync(db.KnowledgeBases.Where(k => k.Id == kbId && !k.IsDeleted), ct);
        var role = kb?.RoleOf(userId);
        if (kb is null || role is null)
        {
            throw new NotFoundException(NotFoundException.KnowledgeBase);
        }

        if (role.Value < minimum)
        {
            throw new AccessDeniedException();
        }

        return kb;
    }

    public async Task<IReadOnlyList<Guid>> AccessibleKnowledgeBaseIdsAsync(CancellationToken ct)
    {
        var userId = currentUser.RequireUserId();
        return await query.ToListAsync(
            db.KnowledgeBases
                .Where(k => !k.IsDeleted && k.Members.Any(m => m.UserId == userId))
                .Select(k => k.Id),
            ct);
    }
}
