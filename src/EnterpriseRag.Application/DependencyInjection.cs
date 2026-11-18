using EnterpriseRag.Application.Auth;
using EnterpriseRag.Application.KnowledgeBases;
using EnterpriseRag.Application.Security;
using EnterpriseRag.Application.Users;
using Microsoft.Extensions.DependencyInjection;

namespace EnterpriseRag.Application;

public static class DependencyInjection
{
    /// <summary>
    /// Registers the access policy and all use-case handlers (scoped). The ports (<c>IAppDbContext</c>,
    /// <c>IAsyncQueryExecutor</c>, <c>IPasswordHasher</c>, <c>ITokenService</c>, <c>IAuditLogger</c>) and the plain
    /// <c>SecurityOptions</c> instance are registered by Infrastructure.
    /// </summary>
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<IAccessPolicy, AccessPolicy>();

        services.AddScoped<LoginHandler>();
        services.AddScoped<RefreshHandler>();
        services.AddScoped<LogoutHandler>();
        services.AddScoped<ChangePasswordHandler>();

        services.AddScoped<CreateUserHandler>();
        services.AddScoped<ListUsersHandler>();
        services.AddScoped<DeactivateUserHandler>();
        services.AddScoped<ResetPasswordHandler>();
        services.AddScoped<SearchUserDirectoryHandler>();
        services.AddScoped<GetCurrentUserHandler>();

        services.AddScoped<CreateKnowledgeBaseHandler>();
        services.AddScoped<ListKnowledgeBasesHandler>();
        services.AddScoped<GetKnowledgeBaseHandler>();
        services.AddScoped<UpdateKnowledgeBaseHandler>();
        services.AddScoped<DeleteKnowledgeBaseHandler>();
        services.AddScoped<AddMemberHandler>();
        services.AddScoped<ChangeMemberRoleHandler>();
        services.AddScoped<RemoveMemberHandler>();
        services.AddScoped<ListMembersHandler>();
        return services;
    }
}
