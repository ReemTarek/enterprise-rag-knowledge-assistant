using EnterpriseRag.Application.Abstractions;
using EnterpriseRag.Application.Auth;
using EnterpriseRag.Application.Common;
using EnterpriseRag.Application.Security;
using EnterpriseRag.Application.Users;
using EnterpriseRag.Domain.Identity;
using EnterpriseRag.Domain.KnowledgeBases;
using EnterpriseRag.Infrastructure.Persistence;
using EnterpriseRag.Infrastructure.Seed;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace EnterpriseRag.Infrastructure.Tests.Persistence;

[Collection(SqlServerCollection.Name)]
public sealed class IdentityPersistenceTests(SqlServerFixture fixture)
{
    private static readonly DateTime FixedNow = new(2026, 5, 6, 7, 8, 9, DateTimeKind.Utc);

    private async Task<ServiceProvider> MigratedAsync(
        Dictionary<string, string?>? overrides = null, FakeDateTimeProvider? clock = null, string? currentUserId = null)
    {
        var sp = InfrastructureHarness.Build(
            fixture.NewDatabaseConnectionString(), clock ?? new FakeDateTimeProvider(FixedNow), overrides, currentUserId);
        await InfrastructureHarness.MigrateAsync(sp);
        return sp;
    }

    private static async Task<T> InScopeAsync<T>(IServiceProvider sp, Func<IServiceProvider, Task<T>> action)
    {
        await using var scope = sp.CreateAsyncScope();
        return await action(scope.ServiceProvider);
    }

    private static Task InScopeAsync(IServiceProvider sp, Func<IServiceProvider, Task> action) =>
        InScopeAsync<int>(sp, async s =>
        {
            await action(s);
            return 0;
        });

    private static async Task<User> AddUserAsync(IServiceProvider sp, string email, string displayName = "Someone")
    {
        var user = User.Create(email, displayName, "hash", GlobalRole.User, mustChangePassword: false);
        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<IAppDbContext>();
            db.Add(user);
            await db.SaveChangesAsync(CancellationToken.None);
        });
        return user;
    }

    [Fact]
    public async Task Migration_Applies_And_HasNoPendingModelChanges()
    {
        await using var sp = await MigratedAsync();
        await using var scope = sp.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        Assert.Empty(await db.Database.GetPendingMigrationsAsync());
        Assert.False(db.Database.HasPendingModelChanges());
        var applied = (await db.Database.GetAppliedMigrationsAsync()).ToList();
        Assert.Contains(applied, m => m.EndsWith("_InitialCreate", StringComparison.Ordinal));
        Assert.Contains(applied, m => m.EndsWith("_AddIdentityAndKnowledgeBases", StringComparison.Ordinal));
        Assert.False(await db.Users.AnyAsync());
        Assert.False(await db.KnowledgeBases.AnyAsync());
        Assert.False(await db.KnowledgeBaseUsers.AnyAsync());
        Assert.False(await db.RefreshTokens.AnyAsync());
    }

    [Fact]
    public void AddIdentityAndKnowledgeBases_MigrationClass_HasNoTimestampPrefix()
    {
        var type = typeof(AppDbContext).Assembly.GetTypes()
            .Single(t => t.Name.EndsWith("AddIdentityAndKnowledgeBases", StringComparison.Ordinal));
        Assert.Equal("AddIdentityAndKnowledgeBases", type.Name);
    }

    [Fact]
    public async Task Email_Unique_AcrossActiveUsers()
    {
        await using var sp = await MigratedAsync();
        var first = await AddUserAsync(sp, "dup@example.com");

        var conflict = await Assert.ThrowsAsync<ConflictException>(() => AddUserAsync(sp, "dup@example.com"));
        Assert.Contains("email", conflict.Message, StringComparison.OrdinalIgnoreCase);

        // After a soft delete the address can be used again.
        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<AppDbContext>();
            var stored = await db.Users.SingleAsync(u => u.Id == first.Id);
            stored.MarkDeleted(FixedNow);
            await db.SaveChangesAsync();
        });
        var second = await AddUserAsync(sp, "dup@example.com");

        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<AppDbContext>();
            Assert.Equal(second.Id, (await db.Users.SingleAsync()).Id);
            Assert.Equal(2, await db.Users.IgnoreQueryFilters().CountAsync());
        });
    }

    [Fact]
    public async Task KnowledgeBaseMember_Unique()
    {
        await using var sp = await MigratedAsync();
        var owner = await AddUserAsync(sp, "owner@example.com");
        var kb = KnowledgeBase.Create("Docs", null, owner.Id);
        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<IAppDbContext>();
            db.Add(kb);
            await db.SaveChangesAsync(CancellationToken.None);
        });

        await Assert.ThrowsAsync<ConflictException>(() => InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<AppDbContext>();
            db.KnowledgeBaseUsers.Add(new KnowledgeBaseUser { KnowledgeBaseId = kb.Id, UserId = owner.Id, Role = KnowledgeBaseRole.Viewer });
            await db.SaveChangesAsync();
        }));
    }

    [Fact]
    public async Task KnowledgeBases_Port_LoadsMembers_AndTranslatesMembershipPredicate()
    {
        await using var sp = await MigratedAsync();
        var owner = await AddUserAsync(sp, "owner@example.com");
        var viewer = await AddUserAsync(sp, "viewer@example.com");
        var stranger = await AddUserAsync(sp, "stranger@example.com");
        var kb = KnowledgeBase.Create("Docs", "d", owner.Id);
        kb.AddMember(viewer.Id, KnowledgeBaseRole.Viewer);
        var deleted = KnowledgeBase.Create("Old", null, viewer.Id);
        deleted.MarkDeleted(FixedNow);
        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<IAppDbContext>();
            db.Add(kb);
            db.Add(deleted);
            await db.SaveChangesAsync(CancellationToken.None);
            Assert.NotEmpty(kb.RowVersion);
        });

        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<IAppDbContext>();
            var query = s.GetRequiredService<IAsyncQueryExecutor>();

            var mine = await query.ToListAsync(db.KnowledgeBases.Where(k => k.Members.Any(m => m.UserId == viewer.Id)), CancellationToken.None);
            var loaded = Assert.Single(mine);
            Assert.Equal(2, loaded.Members.Count);
            Assert.Equal(KnowledgeBaseRole.Owner, loaded.RoleOf(owner.Id));
            Assert.Equal(KnowledgeBaseRole.Viewer, loaded.RoleOf(viewer.Id));
            Assert.Equal(2, loaded.PermissionVersion);

            Assert.Equal(0, await query.CountAsync(db.KnowledgeBases.Where(k => k.Members.Any(m => m.UserId == stranger.Id)), CancellationToken.None));
            Assert.False(await query.AnyAsync(db.KnowledgeBases.Where(k => k.Id == deleted.Id), CancellationToken.None));
        });
    }

    [Fact]
    public async Task KnowledgeBase_MembershipChanges_PersistThroughAggregate()
    {
        await using var sp = await MigratedAsync();
        var owner = await AddUserAsync(sp, "owner@example.com");
        var editor = await AddUserAsync(sp, "editor@example.com");
        var kb = KnowledgeBase.Create("Docs", null, owner.Id);
        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<IAppDbContext>();
            db.Add(kb);
            await db.SaveChangesAsync(CancellationToken.None);
        });

        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<IAppDbContext>();
            var loaded = await s.GetRequiredService<IAsyncQueryExecutor>()
                .FirstOrDefaultAsync(db.KnowledgeBases.Where(k => k.Id == kb.Id), CancellationToken.None);
            loaded!.AddMember(editor.Id, KnowledgeBaseRole.Editor);
            await db.SaveChangesAsync(CancellationToken.None);
        });

        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<IAppDbContext>();
            var loaded = await s.GetRequiredService<IAsyncQueryExecutor>()
                .FirstOrDefaultAsync(db.KnowledgeBases.Where(k => k.Id == kb.Id), CancellationToken.None);
            Assert.Equal(KnowledgeBaseRole.Editor, loaded!.RoleOf(editor.Id));
            loaded.RemoveMember(editor.Id);
            await db.SaveChangesAsync(CancellationToken.None);
        });

        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<AppDbContext>();
            Assert.Equal(1, await db.KnowledgeBaseUsers.CountAsync(m => m.KnowledgeBaseId == kb.Id));
            Assert.Equal(3, (await db.KnowledgeBases.SingleAsync()).PermissionVersion);
        });
    }

    [Fact]
    public async Task KnowledgeBase_StaleRowVersion_ThrowsConflictException()
    {
        await using var sp = await MigratedAsync();
        var owner = await AddUserAsync(sp, "owner@example.com");
        var kb = KnowledgeBase.Create("Docs", null, owner.Id);
        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<IAppDbContext>();
            db.Add(kb);
            await db.SaveChangesAsync(CancellationToken.None);
        });
        var staleVersion = kb.RowVersion.ToArray();

        // Someone else renames it, moving the row version on.
        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<AppDbContext>();
            (await db.KnowledgeBases.SingleAsync()).Rename("Renamed", null);
            await db.SaveChangesAsync();
        });

        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<IAppDbContext>();
            var loaded = await s.GetRequiredService<IAsyncQueryExecutor>()
                .FirstOrDefaultAsync(db.KnowledgeBases.Where(k => k.Id == kb.Id), CancellationToken.None);
            db.SetExpectedRowVersion(loaded!, staleVersion);
            loaded!.Rename("Mine", null);
            await Assert.ThrowsAsync<ConcurrencyConflictException>(() => db.SaveChangesAsync(CancellationToken.None));
        });

        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<AppDbContext>();
            Assert.Equal("Renamed", (await db.KnowledgeBases.SingleAsync()).Name);
        });
    }

    [Fact]
    public async Task KnowledgeBase_CurrentRowVersion_SavesAndAdvancesVersion()
    {
        await using var sp = await MigratedAsync();
        var owner = await AddUserAsync(sp, "owner@example.com");
        var kb = KnowledgeBase.Create("Docs", null, owner.Id);
        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<IAppDbContext>();
            db.Add(kb);
            await db.SaveChangesAsync(CancellationToken.None);
        });

        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<IAppDbContext>();
            var loaded = await s.GetRequiredService<IAsyncQueryExecutor>()
                .FirstOrDefaultAsync(db.KnowledgeBases.Where(k => k.Id == kb.Id), CancellationToken.None);
            db.SetExpectedRowVersion(loaded!, kb.RowVersion);
            loaded!.Rename("Mine", null);
            await db.SaveChangesAsync(CancellationToken.None);
            Assert.False(loaded.RowVersion.AsSpan().SequenceEqual(kb.RowVersion));
        });
    }

    private async Task<(ServiceProvider Sp, RefreshToken Token)> WithStoredTokenAsync()
    {
        var sp = await MigratedAsync();
        var user = await AddUserAsync(sp, "user@example.com");
        var token = new RefreshToken
        {
            UserId = user.Id, TokenHash = "hash-1", FamilyId = Guid.NewGuid(), ExpiresAt = FixedNow.AddDays(7),
        };
        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<IAppDbContext>();
            db.Add(token);
            await db.SaveChangesAsync(CancellationToken.None);
        });
        return (sp, token);
    }

    [Fact]
    public async Task RefreshToken_ConcurrentRotation_SecondSave_ThrowsConflictException()
    {
        var (sp, token) = await WithStoredTokenAsync();
        await using var _ = sp;
        await using var scopeA = sp.CreateAsyncScope();
        await using var scopeB = sp.CreateAsyncScope();
        var dbA = scopeA.ServiceProvider.GetRequiredService<AppDbContext>();
        var dbB = scopeB.ServiceProvider.GetRequiredService<AppDbContext>();

        var a = await dbA.RefreshTokens.SingleAsync(t => t.Id == token.Id);
        var b = await dbB.RefreshTokens.SingleAsync(t => t.Id == token.Id);
        a.RevokedAt = FixedNow;
        a.ReplacedByTokenHash = "replacement-a";
        b.RevokedAt = FixedNow;
        b.ReplacedByTokenHash = "replacement-b";

        await dbA.SaveChangesAsync();
        await Assert.ThrowsAsync<ConflictException>(() => dbB.SaveChangesAsync());

        await using var reader = sp.CreateAsyncScope();
        var stored = await reader.ServiceProvider.GetRequiredService<AppDbContext>().RefreshTokens.SingleAsync();
        Assert.Equal("replacement-a", stored.ReplacedByTokenHash);
    }

    [Fact]
    public async Task SaveChanges_AfterConflict_DoesNotResendFailedChanges()
    {
        var (sp, token) = await WithStoredTokenAsync();
        await using var _ = sp;
        await using var scopeA = sp.CreateAsyncScope();
        await using var scopeB = sp.CreateAsyncScope();
        var dbA = scopeA.ServiceProvider.GetRequiredService<AppDbContext>();
        var dbB = scopeB.ServiceProvider.GetRequiredService<IAppDbContext>();
        var queryB = scopeB.ServiceProvider.GetRequiredService<IAsyncQueryExecutor>();

        var a = await dbA.RefreshTokens.SingleAsync(t => t.Id == token.Id);
        var b = await queryB.FirstOrDefaultAsync(dbB.RefreshTokens.Where(t => t.Id == token.Id), CancellationToken.None);
        a.RevokedAt = FixedNow;
        a.ReplacedByTokenHash = "replacement-a";
        await dbA.SaveChangesAsync();

        b!.RevokedAt = FixedNow.AddMinutes(1);
        b.ReplacedByTokenHash = "replacement-b";
        dbB.Add(new RefreshToken
        {
            UserId = token.UserId, TokenHash = "replacement-b", FamilyId = token.FamilyId, ExpiresAt = FixedNow.AddDays(7),
        });
        await Assert.ThrowsAsync<ConflictException>(() => dbB.SaveChangesAsync(CancellationToken.None));

        // Follow-up save in the same scope (what RefreshHandler does to revoke the family) succeeds and does not
        // re-send the failed rotation.
        var fresh = await queryB.FirstOrDefaultAsync(dbB.RefreshTokens.Where(t => t.Id == token.Id), CancellationToken.None);
        Assert.Equal("replacement-a", fresh!.ReplacedByTokenHash);
        dbB.Add(new RefreshToken
        {
            UserId = token.UserId, TokenHash = "unrelated", FamilyId = Guid.NewGuid(), ExpiresAt = FixedNow.AddDays(7),
        });
        await dbB.SaveChangesAsync(CancellationToken.None);

        await using var reader = sp.CreateAsyncScope();
        var all = await reader.ServiceProvider.GetRequiredService<AppDbContext>().RefreshTokens.ToListAsync();
        Assert.Equal(2, all.Count);
        Assert.DoesNotContain(all, t => t.TokenHash == "replacement-b");
        Assert.Equal("replacement-a", all.Single(t => t.Id == token.Id).ReplacedByTokenHash);
        Assert.Equal(FixedNow, all.Single(t => t.Id == token.Id).RevokedAt);
    }

    [Fact]
    public async Task RefreshToken_Raw_IsNotStored_OnlyHash()
    {
        await using var sp = await MigratedAsync(SeedSettings());
        await RunSeedAsync(sp);

        var result = await InScopeAsync(sp, s => s.GetRequiredService<LoginHandler>()
            .HandleAsync(new LoginCommand(AdminEmail, AdminPassword), CancellationToken.None));

        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<AppDbContext>();
            var stored = await db.RefreshTokens.SingleAsync();
            Assert.Equal(s.GetRequiredService<ITokenService>().HashRefreshToken(result.RefreshToken), stored.TokenHash);
            Assert.NotEqual(result.RefreshToken, stored.TokenHash);

            // No column of any refresh-token row holds the raw value.
            var conn = db.Database.GetDbConnection();
            await conn.OpenAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM RefreshTokens WHERE TokenHash = @raw OR ReplacedByTokenHash = @raw";
            var p = cmd.CreateParameter();
            p.ParameterName = "@raw";
            p.Value = result.RefreshToken;
            cmd.Parameters.Add(p);
            Assert.Equal(0, (int)(await cmd.ExecuteScalarAsync())!);
        });
    }

    [Fact]
    public async Task AuditLogger_PersistsEntryIndependently_WithoutFlushingCallerChanges()
    {
        var actor = Guid.NewGuid().ToString();
        var scoped = InfrastructureHarness.Build(fixture.NewDatabaseConnectionString(), new FakeDateTimeProvider(FixedNow), currentUserId: actor);
        await using var __ = scoped;
        await InfrastructureHarness.MigrateAsync(scoped);

        await InScopeAsync(scoped, async s =>
        {
            var db = s.GetRequiredService<IAppDbContext>();
            db.Add(User.Create("pending@example.com", "Pending", "hash", GlobalRole.User, false));

            await s.GetRequiredService<IAuditLogger>().LogAsync("test.action", "User", "42", new { reason = "x" }, CancellationToken.None);
        });

        await InScopeAsync(scoped, async s =>
        {
            var db = s.GetRequiredService<AppDbContext>();
            var entry = await db.AuditLogs.SingleAsync();
            Assert.Equal("test.action", entry.Action);
            Assert.Equal(actor, entry.ActorId);
            Assert.Equal("User", entry.TargetType);
            Assert.Equal("42", entry.TargetId);
            Assert.Equal(FixedNow, entry.OccurredAt);
            Assert.Equal("{\"reason\":\"x\"}", entry.DetailsJson);
            Assert.False(await db.Users.AnyAsync());
        });
    }

    [Fact]
    public async Task UserDirectory_SearchWithWildcardCharacters_DoesNotMatchEverything()
    {
        // The directory requires a signed-in caller (any id will do; it is not used for filtering).
        await using var sp = await MigratedAsync(currentUserId: Guid.NewGuid().ToString());
        await AddUserAsync(sp, "alice@example.com", "Alice Anders");
        await AddUserAsync(sp, "bob@example.com", "Bob Brown");
        await AddUserAsync(sp, "percent@example.com", "Carol 50%off");

        async Task<IReadOnlyList<DirectoryUserDto>> Search(string term) =>
            await InScopeAsync(sp, s => s.GetRequiredService<SearchUserDirectoryHandler>()
                .HandleAsync(new SearchUserDirectoryQuery(term), CancellationToken.None));

        Assert.Empty(await Search("a%"));
        Assert.Empty(await Search("__"));
        Assert.Empty(await Search("[a-z]"));
        Assert.Equal("percent@example.com", Assert.Single(await Search("0%")).Email);
        Assert.Equal("alice@example.com", Assert.Single(await Search("ali")).Email);
        Assert.Equal(3, (await Search("example")).Count);
    }

    // ---- end-to-end: Application handlers over the real EF context ----

    private const string AdminEmail = "admin@example.com";
    private const string AdminPassword = "Initial-Admin-Pass-1";

    private static Dictionary<string, string?> SeedSettings() => new()
    {
        ["Seed:AdminEmail"] = AdminEmail,
        ["Seed:AdminPassword"] = AdminPassword,
    };

    private static Task RunSeedAsync(IServiceProvider sp) =>
        sp.GetServices<IHostedService>().OfType<AdminSeedHostedService>().Single().StartAsync(CancellationToken.None);

    [Fact]
    public async Task Handlers_RunAgainstRealSql_LoginAndRefreshFlow()
    {
        var clock = new FakeDateTimeProvider(FixedNow);
        await using var sp = await MigratedAsync(SeedSettings(), clock);
        await RunSeedAsync(sp);

        Task<AuthResult> Login() => InScopeAsync(sp, s => s.GetRequiredService<LoginHandler>()
            .HandleAsync(new LoginCommand(AdminEmail, AdminPassword), CancellationToken.None));
        Task<AuthResult> Refresh(string raw) => InScopeAsync(sp, s => s.GetRequiredService<RefreshHandler>()
            .HandleAsync(new RefreshCommand(raw), CancellationToken.None));
        Task<List<RefreshToken>> Tokens() => InScopeAsync(sp, s => s.GetRequiredService<AppDbContext>().RefreshTokens.ToListAsync());

        // Login and rotate.
        var login = await Login();
        Assert.True(login.MustChangePassword);
        clock.UtcNow = FixedNow.AddMinutes(1);
        var rotated = await Refresh(login.RefreshToken);
        Assert.NotEqual(login.RefreshToken, rotated.RefreshToken);
        var family = (await Tokens()).Select(t => t.FamilyId).Distinct().Single();
        Assert.Single(await Tokens(), t => t.RevokedAt is null);

        // Reusing the rotated-away token revokes the whole family, including the live successor.
        await Assert.ThrowsAsync<AuthenticationFailedException>(() => Refresh(login.RefreshToken));
        Assert.All(await Tokens(), t => Assert.NotNull(t.RevokedAt));
        await Assert.ThrowsAsync<AuthenticationFailedException>(() => Refresh(rotated.RefreshToken));

        // Concurrent rotation: B has already read the token (stale, still active) when A rotates it.
        var second = await Login();
        await using var scopeB = sp.CreateAsyncScope();
        var dbB = scopeB.ServiceProvider.GetRequiredService<IAppDbContext>();
        var tokens = scopeB.ServiceProvider.GetRequiredService<ITokenService>();
        var hash = tokens.HashRefreshToken(second.RefreshToken);
        var staleB = await scopeB.ServiceProvider.GetRequiredService<IAsyncQueryExecutor>()
            .FirstOrDefaultAsync(dbB.RefreshTokens.Where(t => t.TokenHash == hash), CancellationToken.None);
        Assert.Null(staleB!.RevokedAt);

        var winner = await Refresh(second.RefreshToken);
        await Assert.ThrowsAsync<AuthenticationFailedException>(() =>
            scopeB.ServiceProvider.GetRequiredService<RefreshHandler>().HandleAsync(new RefreshCommand(second.RefreshToken), CancellationToken.None));

        // The race was treated as theft: the winner's replacement was revoked as well.
        var secondFamily = (await Tokens()).Where(t => t.FamilyId != family).ToList();
        Assert.Equal(2, secondFamily.Count);
        Assert.All(secondFamily, t => Assert.NotNull(t.RevokedAt));
        Assert.Contains(secondFamily, t => t.TokenHash == tokens.HashRefreshToken(winner.RefreshToken));

        var audit = await InScopeAsync(sp, s => s.GetRequiredService<AppDbContext>().AuditLogs.Select(a => a.Action).ToListAsync());
        // Reuse of the old token, presentation of the revoked successor, and the lost rotation race.
        Assert.Equal(3, audit.Count(a => a == AuditActions.RefreshTokenReuseDetected));
        Assert.Equal(2, audit.Count(a => a == AuditActions.TokenRefreshed));
        Assert.Equal(2, audit.Count(a => a == AuditActions.LoginSucceeded));
    }

    [Fact]
    public async Task Handlers_RunAgainstRealSql_WrongPassword_LocksOutAndAudits()
    {
        await using var sp = await MigratedAsync(SeedSettings().Concat(new Dictionary<string, string?>
        {
            ["Security:MaxFailedLogins"] = "2",
        }).ToDictionary());
        await RunSeedAsync(sp);

        for (var i = 0; i < 2; i++)
        {
            await Assert.ThrowsAsync<AuthenticationFailedException>(() => InScopeAsync(sp, s => s.GetRequiredService<LoginHandler>()
                .HandleAsync(new LoginCommand(AdminEmail, "Wrong-Password-1"), CancellationToken.None)));
        }

        await Assert.ThrowsAsync<AuthenticationFailedException>(() => InScopeAsync(sp, s => s.GetRequiredService<LoginHandler>()
            .HandleAsync(new LoginCommand(AdminEmail, AdminPassword), CancellationToken.None)));

        await InScopeAsync(sp, async s =>
        {
            var db = s.GetRequiredService<AppDbContext>();
            Assert.True((await db.Users.SingleAsync()).IsLockedOut(FixedNow));
            Assert.Equal(3, await db.AuditLogs.CountAsync(a => a.Action == AuditActions.LoginFailed));
        });
    }
}
