using EnterpriseRag.Domain.Identity;

namespace EnterpriseRag.API.Contracts;

public sealed record CreateUserRequest(string Email, string DisplayName, GlobalRole GlobalRole);

public sealed record TemporaryPasswordResponse(string TemporaryPassword);
