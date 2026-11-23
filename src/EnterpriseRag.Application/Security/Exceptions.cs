namespace EnterpriseRag.Application.Security;

/// <summary>Resource missing or not visible to the caller. Maps to HTTP 404; never reveals which of the two it was.</summary>
public sealed class NotFoundException(string message) : Exception(message)
{
    public const string KnowledgeBase = "Knowledge base not found.";
}

/// <summary>Caller is known but lacks the required role. Maps to HTTP 403.</summary>
public sealed class AccessDeniedException(string message = "Access denied.") : Exception(message);

/// <summary>Sign-in or token refresh failed. Always carries the same generic message. Maps to HTTP 401.</summary>
public sealed class AuthenticationFailedException() : Exception(GenericMessage)
{
    public const string GenericMessage = "Invalid credentials.";
}
