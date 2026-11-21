using System.Reflection;
using NetArchTest.Rules;

namespace EnterpriseRag.Architecture.Tests;

public class DependencyRulesTests
{
    private static readonly Assembly Domain = typeof(Domain.AssemblyMarker).Assembly;
    private static readonly Assembly Application = typeof(Application.AssemblyMarker).Assembly;
    private static readonly Assembly Infrastructure = typeof(Infrastructure.AssemblyMarker).Assembly;
    private static readonly Assembly Api = typeof(API.AssemblyMarker).Assembly;
    private static readonly Assembly Worker = typeof(Worker.AssemblyMarker).Assembly;
    private static readonly Assembly Shared = typeof(Shared.AssemblyMarker).Assembly;

    public static TheoryData<string> ForbiddenProviderNamespaces => new()
    {
        "Microsoft.EntityFrameworkCore",
        "Microsoft.AspNetCore",
        "Microsoft.AspNetCore.Identity",
        "Hangfire",
        "StackExchange.Redis",
        "RabbitMQ",
        "MassTransit",
        "Amazon",
        "Qdrant",
        "OllamaSharp",
        "MediatR",
        "Microsoft.Data.SqlClient",
    };

    // Guards against vacuous passes: every assembly must load and expose types.
    [Theory]
    [InlineData("EnterpriseRag.Domain")]
    [InlineData("EnterpriseRag.Application")]
    [InlineData("EnterpriseRag.Infrastructure")]
    [InlineData("EnterpriseRag.API")]
    [InlineData("EnterpriseRag.Worker")]
    [InlineData("EnterpriseRag.Shared")]
    public void Assembly_LoadsAndContainsTypes(string name)
    {
        var assembly = new[] { Domain, Application, Infrastructure, Api, Worker, Shared }
            .Single(a => a.GetName().Name == name);

        var types = Types.InAssembly(assembly).GetTypes().ToList();

        Assert.NotEmpty(types);
        Assert.Contains(types, t => t.Name == "AssemblyMarker");
    }

    [Fact]
    public void Domain_DoesNotDependOn_ApplicationInfrastructureApiWorker() =>
        AssertNoDependency(Domain,
            "EnterpriseRag.Application", "EnterpriseRag.Infrastructure",
            "EnterpriseRag.API", "EnterpriseRag.Worker");

    [Theory]
    [MemberData(nameof(ForbiddenProviderNamespaces))]
    public void Domain_DoesNotReference_ProviderNamespaces(string forbidden) =>
        AssertNoDependency(Domain, forbidden);

    [Fact]
    public void Application_DoesNotDependOn_InfrastructureApiWorker() =>
        AssertNoDependency(Application,
            "EnterpriseRag.Infrastructure", "EnterpriseRag.API", "EnterpriseRag.Worker");

    [Theory]
    [MemberData(nameof(ForbiddenProviderNamespaces))]
    public void Application_DoesNotReference_ProviderNamespaces(string forbidden) =>
        AssertNoDependency(Application, forbidden);

    [Fact]
    public void Shared_DoesNotDependOn_DomainApplicationInfrastructureApiWorker() =>
        AssertNoDependency(Shared,
            "EnterpriseRag.Domain", "EnterpriseRag.Application", "EnterpriseRag.Infrastructure",
            "EnterpriseRag.API", "EnterpriseRag.Worker");

    [Fact]
    public void Infrastructure_DoesNotDependOn_ApiWorker() =>
        AssertNoDependency(Infrastructure, "EnterpriseRag.API", "EnterpriseRag.Worker");

    private static readonly string[] ExpectedControllers =
    [
        "AuthController", "MeController", "AdminUsersController", "UserDirectoryController",
        "KnowledgeBasesController", "KnowledgeBaseMembersController",
    ];

    // An empty selection would make every controller rule pass vacuously, so the known controllers must be found.
    [Fact]
    public void Api_ContainsAllKnownControllers()
    {
        var names = Types.InAssembly(Api).That().HaveNameEndingWith("Controller").GetTypes().Select(t => t.Name).ToList();

        Assert.NotEmpty(names);
        Assert.All(ExpectedControllers, expected => Assert.Contains(expected, names));
    }

    // Handlers are final use-case classes; nothing derives from them.
    [Fact]
    public void Application_Handlers_AreSealed()
    {
        var handlers = Types.InAssembly(Application).That().HaveNameEndingWith("Handler");

        Assert.NotEmpty(handlers.GetTypes());
        AssertResult(handlers.Should().BeSealed().GetResult());
    }

    // Controllers talk to Application handlers only: no Infrastructure adapters and no EF Core.
    [Theory]
    [InlineData("EnterpriseRag.Infrastructure")]
    [InlineData("Microsoft.EntityFrameworkCore")]
    public void Controllers_DoNotDependOn_InfrastructureNamespaces(string forbidden) =>
        AssertResult(Types.InAssembly(Api)
            .That().HaveNameEndingWith("Controller")
            .ShouldNot().HaveDependencyOn(forbidden)
            .GetResult());

    private static void AssertNoDependency(Assembly assembly, params string[] forbidden) =>
        AssertResult(Types.InAssembly(assembly)
            .ShouldNot().HaveDependencyOnAny(forbidden)
            .GetResult());

    private static void AssertResult(TestResult result) =>
        Assert.True(result.IsSuccessful,
            "Violating types: " + string.Join(", ", result.FailingTypeNames ?? []));
}
