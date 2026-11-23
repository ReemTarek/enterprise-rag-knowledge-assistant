namespace EnterpriseRag.API.Auth;

/// <summary>
/// Opts an authenticated endpoint out of the must-change-password block. Deliberately used on exactly two actions:
/// <c>POST /api/auth/password</c> (the way out) and <c>GET /api/me</c> (so the client can see why it is blocked).
/// Anonymous endpoints (login, refresh, logout, health) are never blocked and need no marker.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, Inherited = false)]
public sealed class AllowWhilePasswordChangeRequiredAttribute : Attribute;
