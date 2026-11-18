namespace EnterpriseRag.Application.Abstractions;

public interface ICurrentUserService
{
    string? UserId { get; }

    /// <summary>The authenticated user's id, or null when anonymous or the id claim is not a GUID.</summary>
    Guid? UserGuid { get; }

    /// <summary>True when the caller holds the global <c>Admin</c> role. Grants no knowledge-base access.</summary>
    bool IsAdmin { get; }
}
