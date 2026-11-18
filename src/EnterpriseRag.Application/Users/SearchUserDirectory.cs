using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Application.Security;
using FluentValidation;

namespace EnterpriseRag.Application.Users;

public sealed record SearchUserDirectoryQuery(string Query);

/// <summary>Directory entry visible to every authenticated user: name and email only.</summary>
public sealed record DirectoryUserDto(Guid Id, string DisplayName, string Email);

public sealed class SearchUserDirectoryValidator : AbstractValidator<SearchUserDirectoryQuery>
{
    public const int MinQueryLength = 2;
    public const int MaxQueryLength = 100;

    public SearchUserDirectoryValidator()
    {
        RuleFor(q => (q.Query ?? string.Empty).Trim())
            .MinimumLength(MinQueryLength)
            .MaximumLength(MaxQueryLength)
            .OverridePropertyName(nameof(SearchUserDirectoryQuery.Query));
    }
}

public sealed class SearchUserDirectoryHandler(IAppDbContext db, IAsyncQueryExecutor query, ICurrentUserService currentUser)
{
    public const int MaxResults = 20;

    private static readonly SearchUserDirectoryValidator Validator = new();

    public async Task<IReadOnlyList<DirectoryUserDto>> HandleAsync(SearchUserDirectoryQuery request, CancellationToken ct)
    {
        currentUser.RequireUserId(); // defense in depth: the endpoint already requires authentication
        await Validator.ValidateAndThrowAsync(request, ct);
        var term = request.Query.Trim().ToLowerInvariant();

        // Emails are stored lower-case; display names are compared lower-cased (translatable to SQL LOWER()).
        return await query.ToListAsync(
            db.Users
                .Where(u => !u.IsDeleted && u.IsActive && (u.Email.Contains(term) || u.DisplayName.ToLower().Contains(term)))
                .OrderBy(u => u.DisplayName).ThenBy(u => u.Email)
                .Take(MaxResults)
                .Select(u => new DirectoryUserDto(u.Id, u.DisplayName, u.Email)),
            ct);
    }
}
