# Phase 2a — Identity and Knowledge Bases (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Secure authentication (seeded admin, admin-created users, JWT + rotating refresh token), knowledge-base CRUD with membership roles and an access policy that never leaks other users' data, all audited — as a tested REST API.

**Architecture:** Domain-owned `User`/`KnowledgeBase` entities (no ASP.NET Identity types in Domain/Application); Infrastructure supplies password hashing (Identity's `PasswordHasher<T>` only), JWT issuing and refresh-token persistence behind Application ports; use cases are plain handler classes in Application; thin controllers in API; one central `IAccessPolicy` used by every KB handler.

**Tech Stack:** Existing Phase 1 stack + `Microsoft.AspNetCore.Authentication.JwtBearer`, `Microsoft.AspNetCore.Identity` (PasswordHasher only, via `Microsoft.Extensions.Identity.Core`), ASP.NET Core rate limiting (built-in), xUnit, Testcontainers SQL Server.

**Spec:** `docs/superpowers/specs/2026-11-18-enterprise-rag-design.md` (§6 data, §8 security, §11c answers 2–4). Frontend is Phase 2b (separate plan).

## Global Constraints
- Domain and Application reference no provider packages (architecture tests enforce; add `Microsoft.AspNetCore.Identity` to the forbidden list for them). No MediatR.
- All timestamps UTC via `IDateTimeProvider`; the UTC converter from Phase 1 applies.
- Central package management; `TreatWarningsAsErrors`; `Nullable`; net11.0; SDK 11.0.100.
- No secrets in git. The seeded admin's email/password come only from configuration (`Seed:AdminEmail`, `Seed:AdminPassword`, env/user-secrets); no default password exists; if the users table is empty and these are missing, startup fails with a clear message.
- Entity ids are `Guid.CreateVersion7()` by default (sequential clustered keys).
- Authorization decisions come from SQL (KB membership), never from client input or token claims other than the user id and global role.
- A non-member requesting a KB (or any child resource) receives **404**, identical to a non-existent KB; a member without sufficient role receives **403**.
- Every KB endpoint requires authentication (fallback authorization policy = authenticated); only `/health/*`, `POST /api/auth/login`, `POST /api/auth/refresh` and `/` are anonymous.
- Global Admin manages users but has **no implicit access** to KB content.
- Accounts: seeded first admin; admin creates all other users (generated one-time temporary password returned once in the API response; `MustChangePassword = true`); no self-registration, no email sending.
- Controllers contain no business logic (architecture test).
- Commit after each task; trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus
1. A user who is not a member gets 404 (not 403, not data) from **every** KB/member endpoint, including with another KB's valid member id (Task 6 matrix test).
2. Reusing an already-rotated refresh token revokes the whole token family (theft detection) and is rejected (Task 4).
3. A deactivated user cannot refresh and cannot use an existing access token on protected endpoints within one request's lifetime (token validation re-checks `IsActive`) (Task 4/5).
4. The last Owner of a KB cannot be removed, demoted, or leave; KB never ends up ownerless (Task 6).
5. Login failures return the same response for unknown email and wrong password, and repeated failures are throttled (rate limit + lockout counter) (Task 4).

---

### Task 1: Domain model and ids
**Files:**
- Create: `src/EnterpriseRag.Domain/Identity/{User.cs,GlobalRole.cs,RefreshToken.cs}`, `src/EnterpriseRag.Domain/KnowledgeBases/{KnowledgeBase.cs,KnowledgeBaseUser.cs,KnowledgeBaseRole.cs}`
- Modify: `src/EnterpriseRag.Domain/Common/Entity.cs` (default `Id = Guid.CreateVersion7()`)
- Test: `tests/EnterpriseRag.Domain.Tests/{Identity/UserTests.cs,KnowledgeBases/KnowledgeBaseTests.cs}`

**Interfaces — Produces:**
- `enum GlobalRole { User = 0, Admin = 1 }`; `enum KnowledgeBaseRole { Viewer = 0, Editor = 1, Owner = 2 }` (ordered: higher ≥ lower).
- `User : SoftDeletableEntity { string Email (normalized lower-case); string DisplayName; string PasswordHash; GlobalRole GlobalRole; bool IsActive; bool MustChangePassword; int FailedLoginCount; DateTime? LockoutEndUtc; static User Create(string email, string displayName, string passwordHash, GlobalRole role, bool mustChangePassword); void RegisterFailedLogin(DateTime utcNow, int maxAttempts, TimeSpan lockout); void RegisterSuccessfulLogin(); bool IsLockedOut(DateTime utcNow); void Deactivate(); void SetPassword(string passwordHash, bool mustChange); }`
- `RefreshToken : Entity { Guid UserId; string TokenHash; Guid FamilyId; DateTime ExpiresAt; DateTime? RevokedAt; string? ReplacedByTokenHash; bool IsActive(DateTime utcNow); }`
- `KnowledgeBase : SoftDeletableEntity { string Name; string? Description; int PermissionVersion; IReadOnlyCollection<KnowledgeBaseUser> Members; static KnowledgeBase Create(string name, string? description, Guid ownerId); void Rename(...); KnowledgeBaseUser AddMember(Guid userId, KnowledgeBaseRole role); void ChangeMemberRole(Guid userId, KnowledgeBaseRole role); void RemoveMember(Guid userId); KnowledgeBaseRole? RoleOf(Guid userId); }` — every membership change increments `PermissionVersion`; invariants: name 1–200 chars; at least one Owner always remains (`DomainException` otherwise); no duplicate member.
- `KnowledgeBaseUser { Guid KnowledgeBaseId; Guid UserId; KnowledgeBaseRole Role; }`

- [ ] **Step 1:** Failing tests, names: `User_Create_NormalizesEmailToLowerCase`; `User_FiveFailedLogins_LocksOutUntilEnd`; `User_SuccessfulLogin_ResetsFailedCount`; `KnowledgeBase_Create_MakesCreatorOwner`; `KnowledgeBase_RemoveLastOwner_Throws`; `KnowledgeBase_DemoteLastOwner_Throws`; `KnowledgeBase_AddDuplicateMember_Throws`; `KnowledgeBase_MembershipChange_IncrementsPermissionVersion`; `Entity_NewId_IsVersion7` (asserts version nibble 7).
- [ ] **Step 2:** Run `dotnet test tests/EnterpriseRag.Domain.Tests -c Release` — Expected: FAIL (types missing).
- [ ] **Step 3:** Implement the types above (signatures exact).
- [ ] **Step 4:** Run domain + architecture tests — Expected: PASS.
- [ ] **Step 5:** Commit `feat(domain): users, refresh tokens, knowledge bases`.

### Task 2: Application ports and use-case handlers (auth + users + KBs)
**Files:**
- Create: `src/EnterpriseRag.Application/Abstractions/{IPasswordHasher.cs,ITokenService.cs,IUserRepository?—see below}`; `src/EnterpriseRag.Application/{Auth,Users,KnowledgeBases}/**` handlers + DTOs + FluentValidation validators; `src/EnterpriseRag.Application/Security/{IAccessPolicy.cs,AccessDeniedException.cs,NotFoundException.cs}`
- Test: `tests/EnterpriseRag.Application.Tests/**` using hand-written fakes (`FakeClock`, in-memory `IAppDbContext`-free fakes)

**Decision (ruling):** Application talks to persistence through a narrow `IAppDbContext` port (`DbSet`-like `IQueryable<T> Users/KnowledgeBases/RefreshTokens/AuditLogs`, `Add`, `SaveChangesAsync`) implemented by `AppDbContext`; **no EF Core types in Application** — use `IQueryable` + async helpers via a small `IAsyncQueryExecutor` port (`ToListAsync`, `FirstOrDefaultAsync`, `AnyAsync`, `CountAsync`). Handlers are tested against an in-memory fake of these ports.

**Interfaces — Produces (exact):**
- `IPasswordHasher { string Hash(string password); bool Verify(string hash, string password); string GenerateTemporaryPassword(); }`
- `ITokenService { AccessToken CreateAccessToken(User user); RefreshTokenIssue CreateRefreshToken(); string HashRefreshToken(string raw); }` with `record AccessToken(string Value, DateTime ExpiresAtUtc)`, `record RefreshTokenIssue(string Raw, string Hash, DateTime ExpiresAtUtc)`.
- `IAuditLogger { Task LogAsync(string action, string? targetType, string? targetId, object? details, CancellationToken ct); }`
- `IAccessPolicy { Task<KnowledgeBase> RequireKnowledgeBaseAsync(Guid kbId, KnowledgeBaseRole minimum, CancellationToken ct); Task<IReadOnlyList<Guid>> AccessibleKnowledgeBaseIdsAsync(CancellationToken ct); }` — throws `NotFoundException` for non-members/missing, `AccessDeniedException` for insufficient role; reads user id from `ICurrentUserService`.
- Handlers (each `public sealed class XHandler { Task<TResult> HandleAsync(TCommand, CancellationToken) }`): `LoginHandler`, `RefreshHandler`, `LogoutHandler`, `ChangePasswordHandler`, `CreateUserHandler` (admin; returns `CreatedUserResult(Guid Id, string Email, string TemporaryPassword)`), `ListUsersHandler`, `DeactivateUserHandler`, `ResetPasswordHandler`, `SearchUserDirectoryHandler` (name+email only, min 2 chars, max 20 results), `CreateKnowledgeBaseHandler`, `ListKnowledgeBasesHandler` (only the caller's, paged), `GetKnowledgeBaseHandler`, `UpdateKnowledgeBaseHandler` (Owner), `DeleteKnowledgeBaseHandler` (Owner, soft delete), `AddMemberHandler`/`ChangeMemberRoleHandler`/`RemoveMemberHandler` (Owner), `ListMembersHandler` (any member). Every state-changing handler calls `IAuditLogger`.
- Admin-only handlers verify `GlobalRole.Admin` via `ICurrentUserService.IsAdmin` (add `bool IsAdmin` and `Guid? UserGuid` helpers to the interface).

- [ ] **Step 1:** Failing tests (names, with the spec's values): `Login_WrongPassword_And_UnknownEmail_ReturnSameFailure`; `Login_LockedOutUser_Fails_EvenWithCorrectPassword`; `Login_InactiveUser_Fails`; `Refresh_RotatesToken_AndRevokesOld`; `Refresh_ReusedRotatedToken_RevokesWholeFamily`; `Refresh_ForInactiveUser_Fails`; `CreateUser_ByNonAdmin_IsDenied`; `CreateUser_DuplicateEmail_Fails`; `CreateUser_ReturnsTemporaryPassword_AndSetsMustChange`; `AccessPolicy_NonMember_ThrowsNotFound`; `AccessPolicy_ViewerRequestingOwner_ThrowsAccessDenied`; `AccessPolicy_GlobalAdminNonMember_ThrowsNotFound`; `ListKnowledgeBases_ReturnsOnlyCallersMemberships`; `RemoveMember_LastOwner_Fails`; `RemoveMember_ByEditor_IsDenied`; `ChangeMemberRole_IncrementsPermissionVersion`; `SearchDirectory_ShortQuery_Fails`; `StateChangingHandlers_WriteAuditLog` (theory over create-user, create-KB, add-member, remove-member).
- [ ] **Step 2:** Run `dotnet test tests/EnterpriseRag.Application.Tests -c Release` — Expected: FAIL.
- [ ] **Step 3:** Implement ports, handlers, validators (FluentValidation: email format, password ≥ 12 chars with upper/lower/digit for `ChangePassword`, KB name 1–200). Lockout: 5 failed logins → 15 minutes (constants in a `SecurityPolicy` record loaded from options `Security:*` with these defaults; add the options class to Shared with validation).
- [ ] **Step 4:** Run application + architecture tests (add `Microsoft.AspNetCore.Identity` and `Microsoft.EntityFrameworkCore` to the forbidden list if not present) — Expected: PASS.
- [ ] **Step 5:** Commit `feat(application): auth, user admin and knowledge-base use cases`.

### Task 3: Persistence, migration, seed, infrastructure adapters
**Files:**
- Create: `src/EnterpriseRag.Infrastructure/Persistence/Configurations/{User,RefreshToken,KnowledgeBase,KnowledgeBaseUser}Configuration.cs`, `Security/{IdentityPasswordHasher.cs,JwtTokenService.cs}`, `Seed/AdminSeedHostedService.cs`, `Persistence/AuditLogger.cs`, migration `AddIdentityAndKnowledgeBases`; `src/EnterpriseRag.Shared/Options/{JwtOptions.cs,SeedOptions.cs,SecurityOptions.cs}`
- Modify: `AppDbContext` (implements `IAppDbContext`, new DbSets), `DependencyInjection.cs`
- Test: `tests/EnterpriseRag.Infrastructure.Tests/{Persistence/IdentityPersistenceTests.cs,Security/JwtTokenServiceTests.cs,Security/PasswordHasherTests.cs,Seed/AdminSeedTests.cs}`

**Interfaces:** `JwtOptions { string Issuer; string Audience; string SigningKey (≥ 32 bytes, required, no default); int AccessTokenMinutes = 15; int RefreshTokenDays = 7 }`; `SeedOptions { string? AdminEmail; string? AdminPassword }`; unique index on `Users(Email)` (filtered `IsDeleted = 0`), unique `KnowledgeBaseUsers(KnowledgeBaseId, UserId)`, index `KnowledgeBaseUsers(UserId, KnowledgeBaseId)`, unique `RefreshTokens(TokenHash)`, index `RefreshTokens(UserId, FamilyId)`; `rowversion` on `KnowledgeBase`. Access-token claims: `sub` (user id), `role` (global role), `jti`; refresh token raw value is 64 random bytes, stored only as SHA-256 hash.

- [ ] **Step 1:** Failing tests: `Email_Unique_AcrossActiveUsers`; `KnowledgeBaseMember_Unique`; `Migration_Applies_And_HasNoPendingModelChanges`; `PasswordHasher_Verify_RoundTrips_AndRejectsWrong`; `GeneratedTemporaryPassword_MeetsComplexity_And_IsRandom`; `AccessToken_ContainsSubAndRole_AndExpiresInConfiguredMinutes` (fake clock); `AccessToken_SignedWithWrongKey_IsRejectedByValidator`; `RefreshToken_Raw_IsNotStored_OnlyHash`; `AdminSeed_EmptyDb_CreatesAdminOnce`; `AdminSeed_EmptyDb_MissingConfig_FailsStartupWithClearMessage`; `AdminSeed_UsersExist_DoesNothing`; `JwtOptions_ShortSigningKey_FailsValidation`.
- [ ] **Step 2:** Run `dotnet test tests/EnterpriseRag.Infrastructure.Tests -c Release` — Expected: FAIL.
- [ ] **Step 3:** Implement adapters, configurations, options, seed (hosted service runs migrations? No — seed only; migrations stay explicit), generate the migration with `dotnet ef migrations add AddIdentityAndKnowledgeBases` (class name must not carry the timestamp prefix) — verify EF/JwtBearer package versions work on net11.
- [ ] **Step 4:** Run all infrastructure + architecture tests — Expected: PASS.
- [ ] **Step 5:** Commit `feat(infra): identity and knowledge-base persistence, jwt, seed`.

### Task 4: API authentication endpoints
**Files:**
- Create: `src/EnterpriseRag.API/Controllers/{AuthController.cs,MeController.cs}`, `Auth/{AuthenticationSetup.cs,RefreshCookie.cs}`; modify `Program.cs`, `Services/HttpCurrentUserService.cs` (read `sub`; `MapInboundClaims = false`), `GlobalExceptionHandler.cs` (map `NotFoundException`→404, `AccessDeniedException`→403, FluentValidation→400 with field errors, `OperationCanceledException`→499/no log, `BadHttpRequestException`→its own status; ProblemDetails without internals)
- Test: `tests/EnterpriseRag.API.IntegrationTests/{AuthEndpointsTests.cs,AuthorizationDefaultsTests.cs}`

**Interfaces:** `POST /api/auth/login {email,password}` → 200 `{accessToken, expiresAtUtc, mustChangePassword}` + `Set-Cookie: refresh_token` (HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Expires per options); `POST /api/auth/refresh` (cookie) → same shape, rotates cookie; `POST /api/auth/logout` (revokes family, clears cookie); `GET /api/me` → `{id,email,displayName,globalRole,mustChangePassword}`; `POST /api/me/password {currentPassword,newPassword}`. Rate limit policy `login` (fixed window 10/min per IP, 429). Fallback authorization policy requires authentication; access token validated with issuer, audience, signature, lifetime (clock skew 30 s) and an `OnTokenValidated` check that the user is still active.

- [ ] **Step 1:** Failing tests: `Login_Valid_ReturnsAccessToken_AndHttpOnlyRefreshCookie`; `Login_Invalid_Returns401_WithGenericProblemDetails`; `Login_RateLimited_After10Attempts_Returns429`; `Refresh_WithCookie_RotatesCookie`; `Refresh_ReusedOldCookie_Returns401_AndFamilyRevoked`; `ProtectedEndpoint_WithoutToken_Returns401`; `ProtectedEndpoint_WithDeactivatedUserToken_Returns401`; `Health_And_Root_AreAnonymous`; `Me_ReturnsProfile_FromToken`; `CreatedBy_IsFilledFromToken_ForAuditedEntity`; `AuthController_HasNoBusinessLogic_ArchitectureRule` lives in Task 7.
- [ ] **Step 2:** Run `dotnet test tests/EnterpriseRag.API.IntegrationTests -c Release --filter AuthEndpoints|AuthorizationDefaults` — Expected: FAIL.
- [ ] **Step 3:** Implement; controllers call handlers only; JWT config from validated `JwtOptions`; add a test host config supplying `Jwt:SigningKey` and `Seed:*`.
- [ ] **Step 4:** Run all API integration + architecture tests — Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): authentication endpoints, jwt bearer, rate limiting`.

### Task 5: Admin user management and directory endpoints
**Files:**
- Create: `src/EnterpriseRag.API/Controllers/{AdminUsersController.cs,UserDirectoryController.cs}`, `Auth/AdminOnly policy`
- Test: `tests/EnterpriseRag.API.IntegrationTests/{AdminUsersTests.cs,UserDirectoryTests.cs}`

**Interfaces:** `POST /api/admin/users {email,displayName,globalRole}` → 201 `{id,email,temporaryPassword}` (password only in this response, never logged); `GET /api/admin/users?page&pageSize`; `POST /api/admin/users/{id}/deactivate`; `POST /api/admin/users/{id}/reset-password` → `{temporaryPassword}`; `GET /api/users/directory?query=` → `[{id,displayName,email}]` (authenticated users only). Policy `AdminOnly` = authenticated + role claim `Admin`.

- [ ] **Step 1:** Failing tests: `AdminEndpoints_AsNormalUser_Return403`; `AdminEndpoints_Anonymous_Return401`; `CreateUser_ThenLoginWithTemporaryPassword_Succeeds_AndForcesPasswordChange`; `TemporaryPassword_NeverAppearsInLogs` (capture Serilog sink; assert absent); `DeactivatedUser_CannotLogin`; `Directory_ReturnsOnlyNameAndEmail`; `Directory_ShortQuery_Returns400`; `CreateUser_DuplicateEmail_Returns409`.
- [ ] **Step 2:** Run the two test classes — Expected: FAIL.
- [ ] **Step 3:** Implement controllers (thin) and the `AdminOnly` policy; `DomainException`-style duplicate email → 409 via a dedicated `ConflictException` in Application mapped in the exception handler.
- [ ] **Step 4:** Run all API + architecture tests — Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): admin user management and user directory`.

### Task 6: Knowledge-base endpoints and the authorization matrix
**Files:**
- Create: `src/EnterpriseRag.API/Controllers/{KnowledgeBasesController.cs,KnowledgeBaseMembersController.cs}`
- Test: `tests/EnterpriseRag.API.IntegrationTests/{KnowledgeBaseEndpointsTests.cs,KnowledgeBaseAuthorizationMatrixTests.cs}`

**Interfaces:** `POST /api/knowledge-bases`, `GET /api/knowledge-bases?page&pageSize` (caller's only), `GET /api/knowledge-bases/{id}`, `PUT /api/knowledge-bases/{id}` (Owner; `If-Match` rowversion → 412 on mismatch), `DELETE /api/knowledge-bases/{id}` (Owner, soft delete), `GET/POST /api/knowledge-bases/{id}/members`, `PUT/DELETE /api/knowledge-bases/{id}/members/{userId}`. Role matrix: Viewer = read KB + list members; Editor = same (document rights come in Phase 3); Owner = manage KB and members. Removing a member bumps `PermissionVersion`.

- [ ] **Step 1:** Failing tests: `KnowledgeBaseAuthorizationMatrixTests` as a theory over **every** KB/member endpoint × {anonymous→401, non-member→404, viewer, editor, owner} with the expected status per role; `NonMember_GetsSame404Body_AsMissingKb` (response bodies identical apart from correlation id); `ListKnowledgeBases_NeverContainsOthersKbs`; `Update_WithStaleRowVersion_Returns412`; `RemoveLastOwner_Returns409_OrBadRequest` (pick 409 and document); `RemovedMember_LosesAccessImmediately`; `Delete_SoftDeletes_AndSubsequentGetIs404`; `AuditLog_ContainsKbCreateAndMemberChanges`; `GlobalAdmin_NonMember_Gets404`.
- [ ] **Step 2:** Run both classes — Expected: FAIL.
- [ ] **Step 3:** Implement controllers (thin); ensure every handler goes through `IAccessPolicy`; no endpoint accepts a user id other than as a path/body parameter that is checked against membership.
- [ ] **Step 4:** Run all API + architecture tests — Expected: PASS.
- [ ] **Step 5:** Commit `feat(api): knowledge bases, membership and authorization matrix`.

### Task 7: Architecture rules, docs and verification
**Files:**
- Modify: `tests/EnterpriseRag.Architecture.Tests/DependencyRulesTests.cs` (controllers exist now: assert API `*Controller` types depend only on Application/Shared/ASP.NET namespaces, have no dependency on `EnterpriseRag.Domain` entities' mutating members is not enforceable — assert instead that controllers do not reference `EnterpriseRag.Infrastructure` or `Microsoft.EntityFrameworkCore`; assert non-empty selection now), `docs/{SECURITY.md,API_DESIGN.md,DOMAIN_MODEL.md,DATABASE_DESIGN.md,PROJECT_PROGRESS.md}`, `docs/ARCHITECTURE_DECISIONS/0004-authentication-and-authorization.md`, `docs/INFRASTRUCTURE.md` (new config keys: `Jwt__SigningKey`, `Seed__AdminEmail`, `Seed__AdminPassword`; how to generate a signing key)
- Test: architecture tests

- [ ] **Step 1:** Update controller architecture test so an empty selection FAILS (`Assert.NotEmpty`) — Expected after Task 6: PASS.
- [ ] **Step 2:** Write the docs; ADR 0004 records: domain-owned User + Identity's PasswordHasher only (deviates from "full ASP.NET Core Identity" in spec §8 — rationale: Domain must not depend on Identity types; no email/external-login features needed), JWT 15 min + rotating refresh cookie, 404-for-non-members, admin has no implicit KB access, lockout/rate-limit numbers.
- [ ] **Step 3:** Run `dotnet build EnterpriseRag.sln -c Release` and `dotnet test EnterpriseRag.sln -c Release` — Expected: 0 warnings, all tests pass; record real counts.
- [ ] **Step 4:** End-to-end manual check against Compose SQL Server (Release): apply migrations, start API with `Jwt__SigningKey`, `Seed__AdminEmail`, `Seed__AdminPassword` env vars, login as the seeded admin via `curl`, create a user, log in as that user, create a KB, confirm a third user gets 404 on it; record outputs; tear down; delete any `.env`.
- [ ] **Step 5:** Update `PROJECT_PROGRESS.md` honestly; commit `docs: phase 2a complete (pending review)`.

---
## Self-review notes
- Spec §11c coverage: seeded admin + admin-created users ✓ T3/T5; directory-based sharing ✓ T5/T6; removal revokes access immediately incl. history (history arrives Phase 5; `PermissionVersion` + policy re-check on read already in place) ✓ T6; one conversation = one KB (Phase 5). Per-phase deliverables deferred to 2b: Angular shell, login UI, RTL/i18n ar/en/de.
- Deferred Phase-1 minors addressed here: Id GUID v7 (T1), `OperationCanceled`/`BadHttpRequest` handling (T4), `ICurrentUserService` reads `sub` with `MapInboundClaims=false` (T4).
- Names consistent: `IAccessPolicy.RequireKnowledgeBaseAsync`, `KnowledgeBaseRole`, `GlobalRole`, `IAppDbContext`, handler naming `XHandler.HandleAsync`.
- Risk: T2 introduces the `IAppDbContext` + async executor ports; if this proves heavy the implementer must stop and report (no EF types in Application is binding).
