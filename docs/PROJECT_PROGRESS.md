# Project Progress

## Current phase
Phase 2b (Angular client shell) is complete on branch `phase-2b-angular-shell`, **pending the final branch review**.
NOT merged to main. Phase 2a (backend, 401 tests) is merged on main; Phase 1 was completed earlier.

### Phase 2b (branch `phase-2b-angular-shell`, `git log --oneline main..HEAD`)
- 99e9794 docs: Phase 2b implementation plan
- a120cb8 feat(web): scaffold Angular 22 app with Material, lint, proxy and CI job
- 844fcf2 fix(web): run guard self-test as part of lint
- 38180de feat(web): runtime i18n with Arabic RTL, English and German
- c39377a feat(web): auth store, api client and refresh interceptor
- 456b5f7 feat(web): shell, routing, guards, login and forced password change
- 9cff1e8 fix(web): align client password policy with server; pin must-change on the real router
- f85f78a feat(web): knowledge bases and membership UI
- 4e8d3f9 feat(web): admin user management
- d06b115 fix(web): pin non-dismissable temp-password dialog in tests; keep it open across navigation
- docs: phase 2b complete (pending review) (this commit: FRONTEND.md, ADR 0005, INFRASTRUCTURE, this file)

Verification (2026-11-23, real runs, HEAD d06b115 plus docs):
- `npm run lint`: passes (ng lint clean; unsafe-code guard OK; guard self-test 10/10; i18n parity OK).
- `npm run test:ci`: 28 files, 200 tests, all pass.
- `npm run build` (production): succeeds with one warning - initial bundle 546.99 kB raw / 132.24 kB transfer vs the
  500 kB warning budget (error budget 1 MB). Budgets unchanged. Lazy chunks 1.2-84.6 kB raw (20 chunks).
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
- End-to-end through the dev proxy (Compose SQL, migrations, Release API on 5180, `npm start` on 4200, curl against
  http://localhost:4200): `GET /` 200 with `<app-root>`; `/assets/i18n/{ar,en,de}.json` 200 JSON; `/health/ready` 200;
  login of the seeded admin 200 with `accessToken`, `mustChangePassword:true` and
  `Set-Cookie: refresh_token=...; path=/api/auth; secure; samesite=strict; httponly`; `GET /api/knowledge-bases` 403
  `.../problems/password-change-required`; `POST /api/auth/password` 204; same bearer `GET /api/knowledge-bases` 200;
  `POST /api/knowledge-bases` 201 with `ETag`; `GET /api/admin/users` 200. Processes stopped, `docker compose down -v`,
  throwaway `.env` deleted.
- **UI click-through (login -> forced change -> create KB -> members -> admin -> language switch incl. RTL) was NOT
  performed**: no browser-automation tool was available. The manual checklist is in `docs/FRONTEND.md`; the user must
  confirm it.
- CSP finding: the production `index.html` contains one inline script (critical-CSS loader), inline styles and Google
  Fonts loaded from fonts.gstatic.com; plan in `docs/FRONTEND.md` (applied in Phase 11). No `eval` in the build.
- Rough scan of `src`: no TODO/FIXME; one `console.error` (bootstrap failure in `main.ts`); no hard-coded English UI strings found.

Phase 2b decisions: ADR 0005 (Angular 22 zoneless + Material + Vitest; in-memory access token + HttpOnly refresh cookie,
single-flight refresh; Transloco runtime i18n; same-origin dev proxy/no CORS; returnUrl sanitising; ApiError mapping by
problem type; one-time temporary-password dialog).

Phase 2a note (history): the section below describes Phase 2a, which is merged.

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
- Phase 2b final branch review, then merge approval (Phase 2a is merged).
- User: confirm the UI click-through checklist in docs/FRONTEND.md.

Plan items for Phase 2b/3 (from the final review):
- I6: a knowledge base whose owners are all deactivated is unmanageable (no admin back door). Decide: an admin
  "assign owner" action that grants no content access, or user reactivation (admins can only deactivate today).
- M9: members cannot leave a knowledge base (`DELETE .../members/{self}` requires Owner). Add a self-leave in 2b/3.
- 2b frontend: no CORS is configured; the Angular dev server must proxy `/api` (same origin), or CORS with
  credentials must be added deliberately. The `Secure` refresh cookie needs HTTPS or localhost.
- 2b frontend: handle 403 `.../problems/password-change-required` by routing to the change-password screen.

## Known issues
Phase 2b (client; deferred minor findings from per-task reviews, grouped by task):
- Overall: initial bundle 547 kB exceeds the 500 kB warning budget (warning only; raise to about 600 kB with justification or reduce);
  the CI `frontend` job has not run on GitHub; UI click-through not performed (user to confirm); Arabic and German texts have
  no native-speaker review; `Retry-After` is not surfaced (generic 429 text); leaving a knowledge base and admin assign-owner
  do not exist server-side (I6, M9 above; plan with Phase 3); CSP not applied (inline script/styles, Google Fonts, see FRONTEND.md).
- T1: add `engines` to package.json; make strict/strictTemplates explicit in tsconfig; stale .vscode/launch.json ng-test entry
  (Karma); comment on guard false positives; doc stray blank line / "Node 26 used locally"; index.html default title.
- T2: i18n loader URL absolute (/assets/...) ignores base href; init() ignores navigator.languages; no missingHandler (key echo);
  item lacks dir; angular.json reformat churn; storage-failure test does not assert fallback language; Material menu RTL not
  visually verified.
- T3 (items 1, 3, 4 recommended before merge): (1) any failed refresh (network/429/5xx) logs the user out - narrow to 401/403/400;
  (2) restoreSession timeout can orphan a rotated cookie; (3) logout racing an in-flight refresh can re-sign the client in
  (session generation counter); (4) returnUrl sanitising (done in T4 login; keep verified); (5) drop ApiError.problem.detail
  when status >= 500; (6) untested "already on /change-password" branch; (7) weak AuthStore_DoesNotExposeToken test;
  (8) NO_BEARER exact-path matching (trailing slash).
- T4: change-password/login success can stick when sanitised returnUrl equals the current URL; settings link carries no
  returnUrl; compact nav menu loses active marker and name block in role=menu; cross-field errors not tied via aria-describedby
  and no focus to first invalid field; logout has no timeout; authGuard only on parent canActivate (add canActivateChild);
  static index.html English title; 429 text generic; no shared loading component.
- T5 (items 1, 2, 3, 6 recommended before merge): (1) initial bundle 547 kB > 500 kB budget; (2) user-picker: stale in-flight
  search repopulates after the query drops below 2 characters, directory errors swallowed silently; (3) 403 in members tab
  keeps owner controls and does not refresh myRole, 404 mapped to a misleading notAMember; (4) late responses can apply to the
  wrong KB when :id changes (cancel/switchMap; reset() does not clear correlationId); (5) page-size change does not reset to
  page 1, paginator destroyed on every page change (focus loss), no aria-busy, empty state shows "0 of 0" paginator;
  (6) create dialog: whitespace-only name passes required, Cancel/Escape active while pending; (7) no confirm or specific UX for
  self-demotion/self-removal; (8) no explanation for non-owners on the detail page; (9) locale data registered by side-effect
  imports in lazy chunks only (a future DatePipe elsewhere could throw); (10) TranslatedPaginatorIntl subscription leak
  (takeUntilDestroyed); (11) component specs lack httpMock.verify(), mid-edit refreshAfterMembership untested, 428 banner text
  unasserted; (12) unused keys kb.list.open, kb.detail.updated.
- T6: focus loss after paging/reload (use overlay progress + aria-busy); page-size change does not reset to page 1; expired
  lockout dates still shown; displayName maxLength on untrimmed value; focus not moved to email on 409; row-action errors hide
  the correlation id; reset-password offered on own row; create result object retains temporaryPassword (delete after
  hand-off); tests leak navigator.clipboard/documentElement.dir overrides; orphan keys title.admin/admin.title; copy status not
  re-announced.

Environment:
- CI has not run on GitHub yet (backend and frontend jobs); SDK 11.0.100 resolution via setup-dotnet is unverified.
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
- None failing. Not yet validated: CI on GitHub; the UI in a real browser; embedding model choice (Phase 4).

## Next task
1. Phase 2b final branch review (fix the recommended-before-merge items), user confirms the UI checklist, merge decision.
2. Phase 3 plan: documents - upload, S3/local storage, versions, lifecycle + UI (include leave-KB and admin assign-owner).
