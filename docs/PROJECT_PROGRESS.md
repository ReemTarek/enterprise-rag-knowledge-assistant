# Project Progress

## Current phase
Phase 2b (Angular client shell) is complete on branch `phase-2b-angular-shell`, including the Phase 2b hardening
(real-browser defects fixed, full-stack Playwright E2E suite, CI `e2e` job; plan
`docs/superpowers/plans/2026-11-27-phase2b-e2e-and-ui-fixes.md`). **Pending merge approval.** CI on GitHub runs
three jobs (`build-test`, `frontend`, `e2e`); see "Phase 2b hardening" below for the green run. NOT merged to main.
Phase 2a (backend) is merged on main; Phase 1 was completed earlier.

### Phase 2b hardening (2026-11-27)
- Commits: 5c8e63c fix(web): ui defects; bcf0554 / e25f0af E2E harness; 285e7c7 / 6ed5f75 auth, session, i18n/RTL and
  a11y specs; 75a2566 feat(api): configurable auth rate limits; 533c45f / 204505a knowledge base, membership and admin
  specs; 84ddf31 ci: full-stack playwright e2e job; a630dd4 fix(e2e): restore before `dotnet ef` (fresh-clone/CI
  failure); docs: e2e strategy and phase 2b hardening.
- Defects from the real-browser verification fixed, each with a unit test and an E2E regression test: D1 change-password
  hint overlapping the confirm field; D2 faint/missing focus ring; D3 member role select without accessible name; D4
  Latin names/emails not bidi-isolated in Arabic; D5 email inputs RTL in Arabic; D7 sign-out not ending other tabs
  (`BroadcastChannel('erag-auth')`, message carries no secret); D8 gateway 502/503/504 without ProblemDetails shown as
  "Something went wrong" (now the network/unreachable message); A11y-1 toolbar outside a landmark.
- **D6 deferred** (browser Back while the temporary-password dialog is open changes the page behind it; the dialog stays
  by design, harmless) - documented in FRONTEND.md "Known limitations".
- D8 also on the change-password page (final review fix): it now picks the message from the error type
  (`messageKeyFor`), so a gateway 502/503/504 without ProblemDetails shows the network message; unit-tested and covered
  by the E2E test `D8_ChangePassword_GatewayError_ShowsNetworkMessage` (no longer `test.fixme`).
- Configurable auth rate limits (`RateLimit:LoginPermitsPerMinute` default 10, `RateLimit:RefreshPermitsPerMinute`
  default 30, validated; production behaviour unchanged); only the E2E stack raises them (1000/3000) because every client
  of the suite shares one IP.
- E2E suite (`frontend/enterprise-rag-web/e2e`, `@playwright/test` + `@axe-core/playwright`): 56 tests in 8 files
  (smoke 5, auth 7, session 6, i18n-rtl 7, a11y 7, knowledge-bases 9, members 7, admin-users 8); all 56 run (no
  fixme/skip). Local runs: 56 passed (2 workers). CI fails on flaky tests (`failOnFlakyTests`).
- CI: new job `e2e` ("End-to-end (Playwright)") after `build-test` and `frontend`: SQL Server service container,
  `e2e-stack --ci`, readiness wait, `npm run e2e`, artifacts (report, traces, stack log; 3 days - both Playwright artifacts can contain
  traces with the run's generated credentials); `concurrency` cancels superseded non-main runs; fresh database per
  run; no repository secrets (generated + masked; SA password is a CI-only throwaway, see INFRASTRUCTURE.md).
- CI runs: https://github.com/ReemTarek/enterprise-rag-knowledge-assistant/actions/runs/46033634808 (84ddf31): e2e failed
  before the suite - `dotnet ef` NETSDK1004 on a fresh clone (no restore), reproduced locally and fixed in a630dd4;
  https://github.com/ReemTarek/enterprise-rag-knowledge-assistant/actions/runs/46034213586 (a630dd4): build-test,
  frontend and e2e all **success** (e2e job 3 min 20 s: stack ready after ~43 s, suite 77 s, no failed or retried test -
  the test-results artifact stayed empty).

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
- 2b1c17f docs: phase 2b complete (pending review)
- Final-review fix wave:
  - db6b6cb fix(web): refresh-failure policy, logout race and timeout (I1, I2, I8)
  - 3ada4e1 fix(web): members 403 handling, create dialog, user picker, paginator leak, dialogs (I3, I4, I5, M1, M4)
  - a5921e8 chore(web): bundle budget, engines, conflict wording, problem-type drift check (I6, M7, M2, I9 test)
  - docs: record CSP/fonts decision and correct frontend docs (I7, I9; this commit: FRONTEND.md, ADR 0005, SECURITY.md,
    this file)

Fixed in the final-review wave (moved from known issues):
- I1 only a refresh rejected with 400/401/403 ends the session; network/429/5xx keep it, all queued requests fail with
  the refresh's ApiError, the next 401 refreshes again (was T3 item 1).
- I2 `AuthStore` session generation (bumped by `clear()`); a token arriving after logout is dropped (no re-sign-in, no
  retry); `logout()` clears synchronously, detaches the in-flight refresh, revokes best effort with a 5 s timeout; the
  shell navigates at once (was T3 item 3, T4 "logout has no timeout").
- I3 members tab: 403/404 on add/change/remove makes the detail page re-read the KB (demoted owner loses the controls,
  vanished KB becomes Not Found); change/remove 404 shows the generic not-found text; unused `kb.members.notAMember`
  removed (was T5 item 3).
- I4 KB create dialog: `notBlank` name (shared validator, also on the KB edit form), `disableClose` + disabled Cancel
  while pending (was T5 item 6).
- I5 user picker: a short query cancels the in-flight search; failed searches show `userPicker.error` (was T5 item 2).
- I6 initial warning budget 600 kB with the reason in FRONTEND.md "Bundle and budget"; no build warning (was T5 item 1).
- I7 decision recorded (ADR 0005, FRONTEND.md): self-host fonts, drop the inline loader script - first task of Phase 3.
- I8 tests: `RestoreSession_MustChange_SetsFlag` and real-router `MustChange_AfterRestoreSession_LandsOnChangePassword`.
- I9 docs corrected (locale data registration, guard wording, guard test counts, PROBLEM_TYPES drift check now reads
  `ProblemTypes.cs` via `scripts/problem-types-sync.test.mjs`).
- M1 `TranslatedPaginatorIntl` unsubscribes on host destroy (was T5 item 10); M2 neutral `errors.conflict` text (en/de/ar);
  M4 create-user and create-KB dialogs use `closeOnNavigation: false`; M7 `engines.node` in package.json (was T1).

Verification after the fix wave (2026-11-23, real runs):
- `npm run lint`: passes (ng lint clean; unsafe-code guard OK; `test:guard` 12/12 = 6 guard + 4 parity + 2 problem-type
  drift; i18n parity OK).
- `npm run test:ci`: 29 files, 232 tests, all pass.
- `npm run build` (production): succeeds with **no budget warning**; initial 547.61 kB raw / 132.31 kB transfer (main
  539.57 kB + styles 8.04 kB), 20 lazy chunks.
- `npm ci` on Node 26.13.1 with the new `engines` field: no EBADENGINE.

Earlier verification (2026-11-23, real runs, HEAD d06b115 plus docs):
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
  Fonts loaded from fonts.gstatic.com; decision recorded (self-host fonts, `inlineCritical: false`; first task of
  Phase 3), CSP header plan in `docs/FRONTEND.md` (applied in Phase 11). No `eval` in the build.
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
- Phase 2b merge approval (final review, its fix wave and the hardening plan are done; CI green with backend, frontend
  and e2e jobs; Phase 2a is merged). Gate: the user's merge decision.
- First task of Phase 3 (before any non-dev deployment): self-host fonts and remove the inline loader script (ADR 0005
  "Decision recorded").

Plan items for Phase 2b/3 (from the final review):
- I6: a knowledge base whose owners are all deactivated is unmanageable (no admin back door). Decide: an admin
  "assign owner" action that grants no content access, or user reactivation (admins can only deactivate today).
- M9: members cannot leave a knowledge base (`DELETE .../members/{self}` requires Owner). Add a self-leave in 2b/3.
- 2b frontend: no CORS is configured; the Angular dev server must proxy `/api` (same origin), or CORS with
  credentials must be added deliberately. The `Secure` refresh cookie needs HTTPS or localhost.
- 2b frontend: handle 403 `.../problems/password-change-required` by routing to the change-password screen.

## Known issues
Phase 2b (client; deferred minor findings from per-task reviews, grouped by task):
- Overall: the UI click-through is now automated by the E2E suite (screen-reader speech is approximated by axe and
  accessible-name locators, not verified); D6 deferred; Arabic and
  German texts have no native-speaker review; `Retry-After` is not surfaced (generic 429 text); leaving a knowledge base
  and admin assign-owner do not exist server-side (I6, M9 above; plan with Phase 3); CSP not applied and fonts still
  from Google (decided: self-host as the first Phase 3 task); sign-out while the API is unreachable leaves the refresh
  cookie valid until expiry (documented in FRONTEND.md "Known limitations").
- T1: make strict/strictTemplates explicit in tsconfig; stale .vscode/launch.json ng-test entry
  (Karma); comment on guard false positives; doc stray blank line / "Node 26 used locally"; index.html default title.
- T2: i18n loader URL absolute (/assets/...) ignores base href; init() ignores navigator.languages; no missingHandler (key echo);
  item lacks dir; angular.json reformat churn; storage-failure test does not assert fallback language; Material menu RTL not
  visually verified.
- T3 (items 1 and 3 fixed in the final-review wave): (2) restoreSession timeout can orphan a rotated cookie (documented;
  costs one extra login); (4) returnUrl sanitising (done in T4 login; keep verified); (5) drop ApiError.problem.detail
  when status >= 500; (6) untested "already on /change-password" branch; (7) weak AuthStore_DoesNotExposeToken test;
  (8) NO_BEARER exact-path matching (trailing slash).
- T4: change-password/login success can stick when sanitised returnUrl equals the current URL; settings link carries no
  returnUrl; compact nav menu loses active marker and name block in role=menu; cross-field errors not tied via aria-describedby
  and no focus to first invalid field; authGuard only on parent canActivate (add canActivateChild);
  static index.html English title; 429 text generic; no shared loading component.
- T5 (items 1, 2, 3, 6, 10 fixed in the final-review wave): (4) late responses can apply to the
  wrong KB when :id changes (cancel/switchMap; reset() does not clear correlationId); (5) page-size change does not reset to
  page 1, paginator destroyed on every page change (focus loss), no aria-busy, empty state shows "0 of 0" paginator;
  (7) no confirm or specific UX for self-demotion/self-removal; (8) no explanation for non-owners on the detail page;
  (9) locale data registered by side-effect imports in lazy chunks only (documented rule in FRONTEND.md; a future DatePipe
  elsewhere must import it); (11) component specs lack httpMock.verify(), mid-edit refreshAfterMembership untested, 428
  banner text unasserted; (12) unused keys kb.list.open, kb.detail.updated.
- T6: focus loss after paging/reload (use overlay progress + aria-busy); page-size change does not reset to page 1; expired
  lockout dates still shown; displayName maxLength on untrimmed value; focus not moved to email on 409; row-action errors hide
  the correlation id; reset-password offered on own row; create result object retains temporaryPassword (delete after
  hand-off); tests leak navigator.clipboard/documentElement.dir overrides; orphan keys title.admin/admin.title; copy status not
  re-announced.

Environment:
- CI runs on GitHub (backend, frontend and e2e jobs green); GitHub warns that actions/*@v4 target the deprecated Node 20
  runtime (forced to Node 24) - bump the action versions in a later chore.
- Some package versions are pinned lower than latest because of the earlier Smart App Control block (now disabled).
- docs/INFRASTRUCTURE.md shows the database password inline in example commands.

Deferred Phase 1 findings (unchanged):
- T3: no Domain/Application referenced-assemblies check; rule context missing from failure messages.
- T4: "Twice" soft-delete test does not assert DeletedAt unchanged; Id public setter.
- T5: SectionName consts on options ("AI" vs "Ai"); missing options tests (TimeoutSeconds<=0, empty models, absent Database section).
- T6: sync SaveChanges untested.
- T7: assorted test naming/coverage nits; no Serilog bootstrap logger; no comment on version pins; no Swagger-in-Development test.
- T8: readiness check has no explicit timeout (~15 s when the DB is down); "ready" tag literal duplicated; each HealthTests instance starts its own container.
- T9: double runs on push + PR; bare `dotnet restore/test` (timeout-minutes on the frontend/e2e jobs and a
  `concurrency` group were added in Phase 2b hardening).

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
- None failing; no skipped or fixme E2E tests. Not yet validated: embedding model
  choice (Phase 4); native-speaker review of Arabic/German.

## Next task
1. Phase 2b: merge decision.
2. Phase 3 plan: first task self-hosted fonts / no inline loader script (ADR 0005); then documents - upload, S3/local
   storage, versions, lifecycle + UI (include leave-KB and admin assign-owner).
