# Project Progress

## Current phase
Phase 2a (Identity and Knowledge Bases, backend) is complete on branch `phase-2-identity-kb`: the whole-branch final
review was done and its must-fix findings are fixed (one fix wave, below). **Pending merge approval.** NOT merged to
main. Phase 1 (branch `phase-1-foundation`) was completed earlier.

## Completed milestones
Phase 1 (from main @ f3df10c): toolchain and docs scaffold, solution skeleton, architecture tests, Domain base types,
validated options, EF Core context/audit/soft delete, Serilog/correlation id/ProblemDetails, health checks, Compose SQL
Server and CI. Final Phase 1 test count was 76.

Phase 2a (branch `phase-2-identity-kb`, `git log --oneline main..HEAD`):
- aaab09c docs: Phase 2a implementation plan
- 76104bb feat(domain): users, refresh tokens, knowledge bases
- 34ba77c fix(domain): ChangeMemberRole with unchanged role is a no-op
- 51cfe5d feat(application): auth, user admin and knowledge-base use cases
- 8afb650 fix(application): treat refresh-rotation conflict as token reuse
- 1a3f7de feat(infra): identity and knowledge-base persistence, jwt, seed
- 10089a2 feat(application): session-preserving password change, current-user query
- 9c2d6eb feat(api): authentication endpoints, jwt bearer, rate limiting
- c994b32 fix(api): move password change under /api/auth, anonymous logout, role check from SQL
- 5d1dd45 feat(api): admin user management and user directory
- f360295 feat(api): knowledge bases, membership and authorization matrix
- e80c42f test: enforce controllers exist and handlers sealed
- f58691b docs: phase 2a complete (pending review)
- Final-review fix wave:
  - f812610 fix(api): enforce must-change-password server-side (C1)
  - c1fda03 fix: membership race 409, stale If-Match, paging overflow, password oracle, seed gate (I1-I4)
  - e310771 fix(api): error contract, enum strictness, token no-store, password length (M1-M4)
  - docs: phase 2a final-review fixes (this file, SECURITY, API_DESIGN, INFRASTRUCTURE, ADR 0004)

Fixed in the final-review wave (moved from known issues):
- C1 `mustChangePassword` enforced server-side: SQL-derived server claim, requirement on default/fallback/AdminOnly
  policies, allowlist `POST /api/auth/password` + `GET /api/me`, 403 `.../problems/password-change-required`; same
  token works after the change; admin reset blocks existing tokens immediately.
- I1 lost race without If-Match is 409 (only client-supplied row versions give 412); stale If-Match with an unchanged
  body is 412 (compared before saving).
- I2 huge `?page=` returns 200 with an empty page (page clamped, skip computed in long).
- I3 `POST /api/auth/password` rate limited with login (10/min/IP); wrong current passwords count towards lockout.
- I4 seed: no pending-migration gate; tolerates only SQL 207/208 and connectivity failures; otherwise an empty Users
  table without Seed config fails startup.
- `IAppDbContext.SaveChangesAsync` documents that a conflict detaches all tracked entities.
- M1 error contract (`type`, `title`, `status`, `traceId`, `correlationId` on every ProblemDetails); M2 integer enums
  rejected; M3 `no-store` on token responses and dead refresh cookie deleted on a failed refresh; M4 128-char password
  maximum (change, login, seed). Also closes earlier deferrals: dead cookie after failed refresh and ChangePassword not
  rate limited (T4), seed pending-migration gate and port doc (T3), membership 412 race, paging overflow and the
  stale-unchanged test (T6), integer `globalRole` HTTP test (T5).

## Status
Verification after the final-review fix wave, 2026-11-21 (Release):
- `dotnet build EnterpriseRag.sln -c Release`: 0 warnings, 0 errors.
- `dotnet test EnterpriseRag.sln -c Release`: all pass - Domain 16, Application 101, Architecture 38, Infrastructure 56,
  API.IntegrationTests 190 (401 tests, 0 failures). The API suite takes about 3.3 minutes (Testcontainers).
- The end-to-end run below predates the fix wave (it was done on f58691b) and was not repeated. With C1 the seeded
  admin must now change its password before any admin call.

Earlier verification (f58691b): 362 tests (Domain 16, Application 90, Architecture 38, Infrastructure 50, API 168).
- End-to-end against the Compose SQL Server (Release API on 127.0.0.1:5187, migrations applied with the documented
  `dotnet ef` command): seeded admin login 200; admin created two users (201, temporary password returned once);
  first login `mustChangePassword: true`, password change 204, re-login `mustChangePassword: false`; user B created a
  knowledge base (201, Owner); user C got 404 on it, identical 404 body to a random GUID (apart from correlationId and
  traceId); the global admin (non-member) got 404; B added C as Viewer: C GET 200, C PUT 403; B removed C: C GET 404
  immediately with the same access token; PUT without If-Match 428; unauthenticated `/api/me` 401;
  `/health/ready` 200. API stopped, `docker compose down -v` run, throwaway `.env` deleted.
- Note: run the API from its project directory (`dotnet run --project ...` does this); starting the dll from another
  working directory does not find appsettings.json and fails options validation.

## Decisions
- ADRs 0001 Onion architecture, 0002 Ollama provider, 0003 .NET 11 / Node 26 toolchain,
  0004 authentication and authorization (domain-owned User + Identity `PasswordHasher<T>` only, JWT + rotating refresh cookie,
  404-for-non-members, no admin back door).
- Request-shape errors (400/428) are evaluated before resource resolution.
- Password change is `POST /api/auth/password` (needs the `Path=/api/auth` refresh cookie to keep the current session).
- Logout is anonymous (refresh cookie is the credential).
- The role claim is re-checked against SQL (active, not deleted, same role) on every authenticated request.
- Stale or malformed knowledge-base rowversion: 412 (`ConcurrencyConflictException`); `If-Match` is required (428 when absent).
- Removing/demoting the last owner: 409. `ConflictException` = 409 generically; `ConcurrencyConflictException` is a subclass mapped to 412.
  Only a failed client precondition (If-Match) is 412; a lost race without If-Match is 409.
- `mustChangePassword` is enforced server-side, deny-by-default (ADR 0004): requirement on default/fallback/AdminOnly,
  opt-out `[AllowWhilePasswordChangeRequired]` on `POST /api/auth/password` and `GET /api/me` only.
- Every ProblemDetails carries a stable `type` (`https://enterprise-rag.local/problems/<kind>`); enums bind from strings only.
- Phase 1 rulings still apply: Worker has no database until Phase 6; global soft-delete filter by convention; Serilog.AspNetCore
  pinned to 10.0.0 and Swashbuckle to 11.0.0 (Smart App Control history); `Ai:EmbeddingDimensions` 768 changes with the Phase 4 model.

## Important file locations
- Spec: docs/superpowers/specs/2026-11-18-enterprise-rag-design.md
- Plans: docs/superpowers/plans/ (Phase 1, Phase 2a)
- ADRs: docs/ARCHITECTURE_DECISIONS/
- Docs: ARCHITECTURE, INFRASTRUCTURE, SECURITY, API_DESIGN, DOMAIN_MODEL, DATABASE_DESIGN, IMPLEMENTATION_ROADMAP (all in docs/)
- Solution: EnterpriseRag.sln; src/EnterpriseRag.*; tests/EnterpriseRag.*
- Compose: docker-compose.yml (+ .env.example); CI: .github/workflows/ci.yml
- Migrations: src/EnterpriseRag.Infrastructure/Persistence/Migrations

## Pending work
- Merge approval for Phase 2a.
- Phase 2b plan (must include the items below).

Plan items for Phase 2b/3 (from the final review):
- I6: a knowledge base whose owners are all deactivated is unmanageable (no admin back door). Decide: an admin
  "assign owner" action that grants no content access, or user reactivation (admins can only deactivate today).
- M9: members cannot leave a knowledge base (`DELETE .../members/{self}` requires Owner). Add a self-leave in 2b/3.
- 2b frontend: no CORS is configured; the Angular dev server must proxy `/api` (same origin), or CORS with
  credentials must be added deliberately. The `Secure` refresh cookie needs HTTPS or localhost.
- 2b frontend: handle 403 `.../problems/password-change-required` by routing to the change-password screen.

## Known issues
Environment:
- CI has not run on GitHub yet; SDK 11.0.100 resolution via setup-dotnet is unverified.
- Some package versions are pinned lower than latest because of the earlier Smart App Control block (now disabled).
- docs/INFRASTRUCTURE.md shows the database password inline in example commands.

Deferred Phase 1 findings (unchanged):
- T3: no Domain/Application referenced-assemblies check; rule context missing from failure messages.
- T4: "Twice" soft-delete test does not assert DeletedAt unchanged; Id public setter.
- T5: SectionName consts on options ("AI" vs "Ai"); missing options tests (TimeoutSeconds<=0, empty models, absent Database section).
- T6: sync SaveChanges untested.
- T7: assorted test naming/coverage nits; no Serilog bootstrap logger; no comment on version pins; no Swagger-in-Development test.
- T8: readiness check has no explicit timeout (~15 s when the DB is down); "ready" tag literal duplicated; each HealthTests instance starts its own container.
- T9: ci.yml has no timeout-minutes/concurrency; double runs on push + PR; bare `dotnet restore/test`.

Known issues from the Phase 2a final review (deferred, documented in SECURITY.md):
- I5: lost update on the failed-login counter under concurrency - Phase 11. Do NOT add a rowversion to `User` (it
  creates an existence/timing oracle); the fix is an atomic `UPDATE ... SET FailedLoginCount = FailedLoginCount + 1`.
- M5: audit is written after commit; a failed audit write returns 500 after the change committed (for CreateUser the
  one-time temporary password is lost; recovery = admin reset).
- M6: `RevokeFamily` filters on `FamilyId` only (no `UserId` guard); expired refresh tokens are never purged - Phase 6
  (Worker cleanup job).
- M7: the seed password is only length-checked (no complexity policy) and the seed email is not format-validated.
- M8: after a user-initiated password change, other sessions' access tokens stay valid for up to 15 minutes.
- M11: Serilog request logging records query strings, including user-directory search terms.
- JWT signing-key rotation is not supported (single key).
- DEFER (ledger, brief): no `WWW-Authenticate` on credential-failure 401s (by design); DB check also runs on anonymous
  endpoints with a stale Bearer header; DB outage in `OnTokenValidated` likely 500 not 503; null-IP rate-limit bucket;
  proxy-aware client IP (Phase 11); every unique violation maps to 409; `SuccessRehashNeeded` not surfaced; audit
  in its own context; audit append-only enforced in EF only (DB-level in Phase 10); member list shows emails to
  Viewers (product decision); 499 has no body; API test suite duration.

Deferred Phase 2a findings (from per-task reviews; items fixed in the final wave removed):
- T1 (Domain): lockout edge cases (`maxAttempts <= 0` unguarded); missing tests for UTC-kind, non-member and PermissionVersion cases.
- T2 (Application): reuse audit is noisy for non-rotated revoked tokens; the wrong-password path saves once more than needed (timing);
  weak email validation.
- T3 (Infrastructure): every unique violation maps to 409; seed email not format-validated; `SuccessRehashNeeded` not surfaced;
  AuditLogger uses a separate context/connection.
- T4 (API auth): the DB check also runs on anonymous endpoints when a stale Bearer header is sent; `WWW-Authenticate` not sent on
  credential-failure 401s (documented as intended); null-IP rate-limit bucket; a DB outage inside `OnTokenValidated` likely yields 500.
- T5 (admin API): no HTTP test for an unknown role string; the log-sink test does not assert request logging of the POSTs.
- T6 (knowledge bases): the member list exposes all members' emails to Viewers (product decision to confirm); the API test suite
  takes about 3.3 minutes.

## Failing tests/outstanding validation
- None failing. Not yet validated: CI on GitHub; embedding model choice (Phase 4).

## Next task
1. Phase 2a merge decision (pending approval).
2. Phase 2b plan: Angular shell, login UI (incl. forced password change), RTL/i18n (ar/en/de), same-origin dev proxy;
   decide I6 and M9.
