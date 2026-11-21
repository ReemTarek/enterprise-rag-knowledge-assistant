# Project Progress

## Current phase
Phase 2a (Identity and Knowledge Bases, backend) is complete and verified on branch `phase-2-identity-kb`, pending
whole-branch review. NOT merged to main. Phase 1 (branch `phase-1-foundation`) was completed earlier.

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
- Task 7: this docs and verification commit (`docs: phase 2a complete (pending review)`)

## Status
Verification on 2026-11-21 (Release):
- `dotnet build EnterpriseRag.sln -c Release`: 0 warnings, 0 errors.
- `dotnet test EnterpriseRag.sln -c Release`: all pass - Domain 16, Application 90, Architecture 38, Infrastructure 50,
  API.IntegrationTests 168 (362 tests, 0 failures). The API suite takes about 2.75 minutes (Testcontainers).
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
- Phase 2a final branch review, then merge decision.
- Phase 2b plan.

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

Deferred Phase 2a findings (from per-task reviews):
- T1 (Domain): lockout edge cases (`maxAttempts <= 0` unguarded); missing tests for UTC-kind, non-member and PermissionVersion cases.
- T2 (Application): reuse audit is noisy for non-rotated revoked tokens; the wrong-password path saves once more than needed (timing);
  weak email validation; admin rights were tied to the token role (now fixed by the SQL role check).
- T3 (Infrastructure): seed gates on ANY pending migration (should tolerate only SqlException 207/208 and otherwise throw, which
  touches the fail-fast constraint); every unique violation maps to 409; `ChangeTracker.Clear` detaches all tracked entities (port doc);
  seed email not format-validated; `SuccessRehashNeeded` not surfaced; AuditLogger uses a separate context/connection.
- T4 (API auth): the DB check also runs on anonymous endpoints when a stale Bearer header is sent; `WWW-Authenticate` missing on
  401s from the exception path; null-IP rate-limit bucket; dead cookie left after a failed refresh; ChangePassword not rate limited;
  a DB outage inside `OnTokenValidated` likely yields 500.
- T5 (admin API): no HTTP test for `globalRole: 99` / unknown string; the log-sink test does not assert request logging of the POSTs.
- T6 (knowledge bases): a membership race returns 412 without If-Match (should be 409); a huge `?page=` overflows to a negative
  OFFSET and returns 500 (`Common.cs` paging, shared with the users list); stale If-Match + unchanged body is untested; the member
  list exposes all members' emails to Viewers (product decision to confirm); the API test suite takes about 2.75 minutes.
- Also noted in Task 7: `mustChangePassword` is reported but not enforced server-side.

## Failing tests/outstanding validation
- None failing. Not yet validated: CI on GitHub; embedding model choice (Phase 4).

## Next task
1. Phase 2a final branch review, then merge decision.
2. Phase 2b plan: Angular shell, login UI, RTL/i18n (ar/en/de).
