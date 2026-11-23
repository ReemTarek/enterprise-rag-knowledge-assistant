# Phase 2b — Angular Shell, Auth UI, Knowledge Bases and Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A secure, accessible Angular web client (Arabic RTL, English, German) for the Phase 2a API: sign-in with forced password change, knowledge-base list/detail/members, admin user management, language switching — as a tested, buildable app wired into CI.

**Architecture:** Angular 22 standalone components, lazy-loaded feature routes (`auth`, `knowledge-bases`, `admin`, `settings`), signals for state, Angular Material. The access token lives **in memory only**; the refresh token is the API's HttpOnly cookie (never visible to JS). A functional HTTP interceptor adds the bearer token and performs single-flight refresh-and-retry. All calls go through the dev-server proxy to the same origin (no CORS).

**Tech Stack:** Angular 22.3.x (CLI verified to support Node 26: `^22.22.3 || ^24.15.0 || >=26.0.0`), TypeScript strict, Angular Material 22, a runtime i18n library (Transloco preferred; ngx-translate if Transloco does not support Angular 22 — verify peer deps first), angular-eslint, the CLI's default unit-test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-18-enterprise-rag-design.md` (§3, §8, §11c-6 languages). API contract: `docs/API_DESIGN.md`, `docs/SECURITY.md` (read both first).

## Global Constraints
- Frontend lives in `frontend/enterprise-rag-web`; feature-oriented folders; no NgModules (standalone only); strict TypeScript and strict templates.
- **No tokens or secrets in `localStorage`, `sessionStorage`, IndexedDB, cookies set by JS, URLs, or logs.** The access token is held in memory (signal/service field) only; page reload restores the session via `POST /api/auth/refresh` (cookie).
- Never use `innerHTML` bindings / `bypassSecurityTrust*`; render all server strings as text.
- Languages: `ar` (RTL), `en`, `de`; every user-visible string comes from translation files (no hard-coded UI text); key parity across the three files is enforced by a test; `<html lang>` and `dir` follow the active language; default language = browser language if supported, else `en`; the choice (a non-sensitive string) may be persisted in `localStorage`.
- UI hides/disables actions by role for usability only; the server remains the authority — every API error (401/403/404/409/412/428) has a handled UX path.
- API errors are RFC 7807 ProblemDetails with `type`, `title`, `status`, `correlationId`; show the translated generic message plus the correlation id for 5xx; never display raw `detail` from 5xx.
- Temporary passwords (admin create/reset) are shown once in a dialog with a copy button, never stored, and cleared from memory when the dialog closes.
- Accessibility: all controls labelled, keyboard operable, visible focus, form errors announced (`aria-live`/Material error semantics), sufficient contrast; RTL mirrors layout.
- Versions pinned by `package-lock.json`; use `npm ci` in CI; no deprecated libraries; `npm audit --omit=dev --audit-level=high` clean or documented.
- Do not modify backend code in this phase except what a task explicitly says (none planned).
- Commit after each task with trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (exact text).

## Review Focus
1. Token never persisted: a test spies on `Storage`/`indexedDB`/`document.cookie` writes during login/refresh/logout and asserts no token material is written (Task 3).
2. Single-flight refresh: N concurrent 401 responses trigger exactly ONE refresh call and all N requests retry once; a failed refresh logs out and routes to `/login` without loops (Task 3).
3. Forced password change cannot be bypassed in the UI: with `mustChangePassword` true (from login response or the 403 `password-change-required` problem type), every route except `/change-password` and logout redirects to the change page; after success the same session continues (Task 4).
4. RTL: `ar` sets `dir="rtl"` and `lang="ar"`; `en`/`de` set `ltr`; translation key parity across ar/en/de enforced; no hard-coded strings (Task 2/7).
5. Authorization UX: a 404 on a knowledge base shows a "not found" page indistinguishable for missing/forbidden; a member without rights sees controls disabled and the server 403 handled; 412/428 on rename show a "changed by someone else — reload" flow (Task 5).
6. Secrets/XSS: temp password dialog behaviour; no `innerHTML`; user-supplied names with `<script>` render as text (Task 5/6).

---

### Task 1: Scaffold, tooling, proxy, CI job
**Files:**
- Create: `frontend/enterprise-rag-web/**` (via the CLI), `frontend/enterprise-rag-web/proxy.conf.json`, `.github/workflows/ci.yml` (add job `frontend`), `frontend/enterprise-rag-web/README.md`
- Modify: `.gitignore` (node_modules, dist, .angular already present — verify), `docs/INFRASTRUCTURE.md` (dev run instructions)

**Interfaces — Produces:** npm scripts `start` (ng serve with proxy), `build`, `test` (non-interactive/headless, single run: `test:ci`), `lint`; app prefix `app`; proxy `/api` and `/health` → `http://127.0.0.1:5180` (API's launch-profile port; make target configurable via an env/README note); SCSS; routing enabled; **no SSR, no zone-less decision beyond CLI defaults** (record what the CLI generates).

- [ ] **Step 1:** Verify the toolchain (`node --version`, `npm view @angular/cli engines`), then scaffold with `npx @angular/cli@22.3.0 new enterprise-rag-web --directory frontend/enterprise-rag-web --routing --style=scss --ssr=false --skip-git --package-manager=npm` (flags per the CLI's actual options; adapt and record). Add `@angular/material` via `ng add` (non-interactive) with a custom theme file (light + dark via `prefers-color-scheme` tokens is optional; keep simple) and animations as the CLI generates.
- [ ] **Step 2:** Add angular-eslint (`ng add angular-eslint`) with rules incl. `@angular-eslint/template/no-inline-styles`? (keep defaults) and a rule/grep guard that fails on `innerHTML`/`bypassSecurityTrust` (a lint rule or a CI script `scripts/check-no-unsafe.mjs`).
- [ ] **Step 3:** Write `proxy.conf.json`; failing-then-passing smoke test: `AppComponent_Creates` (the CLI's default spec adapted), run `npm run test:ci` — Expected: PASS, headless, exits 0.
- [ ] **Step 4:** `npm run lint`, `npm run build` — Expected: both succeed with 0 errors/warnings (record bundle size). `npm audit --omit=dev --audit-level=high` — record result (fix or document).
- [ ] **Step 5:** Add the CI job: checkout, setup-node (use `node-version-file`/`24.x` LTS — verify setup-node resolves; document why not 26), `npm ci`, lint, test:ci, build; `working-directory: frontend/enterprise-rag-web`; `permissions: contents: read`; cache npm. Validate YAML by eye (no parser available locally) and say first real run happens on GitHub.
- [ ] **Step 6:** Commit `feat(web): scaffold Angular 22 app with Material, lint, proxy and CI job`.

### Task 2: i18n (ar/en/de), RTL, language switcher
**Files:**
- Create: `src/app/core/i18n/{language.service.ts,language.service.spec.ts,i18n.providers.ts}`, `src/assets/i18n/{en,de,ar}.json` (or the library's location), `src/app/shared/language-switcher/*`, `scripts/check-i18n-parity.mjs` (+ npm script `i18n:check` wired into `test:ci`/lint)
- Modify: `app.config.ts`, `index.html` (default `lang`/`dir`), `app.component` shell placeholder

**Interfaces — Produces:** `LanguageService { readonly current: Signal<'en'|'de'|'ar'>; readonly dir: Signal<'ltr'|'rtl'>; set(lang): void; init(): void }` — `set` updates `document.documentElement.lang/dir`, the i18n library's active language and `localStorage['lang']` (try/catch); translation key convention `feature.section.key`; common keys `common.*`, `errors.*` (including keys for each ProblemDetails `type`), `auth.*`, `kb.*`, `admin.*`.

- [ ] **Step 1:** Verify the i18n library supports Angular 22 (peer deps / npm view); choose Transloco (`@jsverse/transloco`) else ngx-translate; record in the ADR (Task 7).
- [ ] **Step 2:** Failing tests: `LanguageService_Arabic_SetsRtlAndLang`; `LanguageService_English_SetsLtr`; `LanguageService_DefaultsToBrowserLanguageIfSupported_ElseEnglish`; `LanguageService_PersistsChoice_AndSurvivesStorageFailure` (mock localStorage throwing); `Translations_HaveSameKeysInAllLanguages` (reads the three JSON files, deep-flattens, asserts equal key sets and non-empty values); `Translations_NoPlaceholderMismatch` (same `{{param}}` names per key).
- [ ] **Step 3:** Run — Expected: FAIL. Implement the service, providers, three translation files with the keys used in Tasks 4–6 as they are added (start with `common.*`, `app.*`, `language.*`), switcher component (Material menu, `aria-label` translated, shows native language names: English, Deutsch, العربية).
- [ ] **Step 4:** Run tests + `npm run i18n:check` + lint + build — Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): runtime i18n with Arabic RTL, English and German`.

### Task 3: API client, auth store, interceptor (in-memory token, single-flight refresh)
**Files:**
- Create: `src/app/core/api/{problem-details.ts,api-error.ts,api-client.service.ts}`, `src/app/core/auth/{auth.store.ts,auth.service.ts,auth.interceptor.ts,auth.models.ts}` + specs
- Modify: `app.config.ts` (provideHttpClient(withInterceptors([...])))

**Interfaces — Produces (exact):**
- `interface ProblemDetails { type: string; title: string; status: number; detail?: string; correlationId?: string; errors?: Record<string,string[]> }`; `class ApiError extends Error { status: number; type: string; correlationId?: string; problem: ProblemDetails; isPasswordChangeRequired: boolean }`; `PROBLEM_TYPES` constants matching the server URIs documented in `docs/API_DESIGN.md` (read it; do not guess URIs).
- `AuthStore { readonly accessToken: Signal<string|null> (private set); readonly user: Signal<CurrentUser|null>; readonly mustChangePassword: Signal<boolean>; readonly isAuthenticated: Signal<boolean>; readonly isAdmin: Signal<boolean>; setSession(...); clear(): void }` — token stored only in a private field/signal, never exported to storage.
- `AuthService { login(email,password): Observable<void>; restoreSession(): Observable<boolean> (POST /api/auth/refresh with credentials, then GET /api/me); refresh(): Observable<string> (single-flight shared observable); logout(): Observable<void>; changePassword(current,new): Observable<void>; loadMe(): Observable<CurrentUser> }`; all requests `withCredentials` only for `/api/auth/*`.
- `authInterceptor: HttpInterceptorFn` — adds `Authorization: Bearer` to `/api/**` except `/api/auth/login|refresh|logout`; on 401 for a bearer request (not already retried) → `AuthService.refresh()` (single-flight) then retry once; on refresh failure → `AuthStore.clear()` + navigate `/login` (with `returnUrl`); on 403 with `password-change-required` → set `mustChangePassword` and navigate `/change-password`; maps HttpErrorResponse bodies to `ApiError`.

- [ ] **Step 1:** Failing tests (HttpTestingController): `Login_Success_StoresTokenInMemory_AndLoadsMe`; `Login_Failure_MapsGeneric401`; `Interceptor_AddsBearer_ToApiCalls_NotToLogin`; `Interceptor_On401_RefreshesOnce_ForConcurrentRequests` (fire 5 requests, all 401 → exactly 1 refresh request, all 5 retried once with the new token); `Interceptor_RefreshFails_LogsOutAndRedirectsToLogin_NoLoop`; `Interceptor_On403PasswordChangeRequired_RedirectsToChangePassword`; `Token_IsNeverWrittenToStorage` (spy `Storage.prototype.setItem`, `document.cookie` setter, `indexedDB.open`; run login+refresh+logout; assert no call carried token material); `RestoreSession_UsesCookieRefresh_OnAppStart`; `ApiError_MapsProblemDetails_AndCorrelationId`.
- [ ] **Step 2:** Run `npm run test:ci` — Expected: FAIL.
- [ ] **Step 3:** Implement per Interfaces (RxJS `shareReplay`/`finalize` for single-flight; avoid refresh loops by tagging retried requests with an `HttpContext` token).
- [ ] **Step 4:** Run tests, lint, build — Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): auth store, api client and refresh interceptor`.

### Task 4: Shell, routing, guards, login and forced password change
**Files:**
- Create: `src/app/app.routes.ts`, `src/app/core/auth/{auth.guard.ts,admin.guard.ts,must-change.guard.ts}`, `src/app/layout/shell/*`, `src/app/features/auth/{login/*,change-password/*}`, `src/app/shared/{not-found/*,forbidden/*,error-banner/*,loading/*}` + specs
- Modify: `app.component`, `app.config.ts` (APP_INITIALIZER/`provideAppInitializer` → `restoreSession()` before first navigation, never blocking forever: timeout → unauthenticated)

**Interfaces:** routes: `/login`, `/change-password` (auth required; allowed while mustChange), `/` → redirect to `/knowledge-bases`, lazy `knowledge-bases`, lazy `admin` (adminGuard), `/settings` (password change link, language), `**` → NotFound; `authGuard` (redirect to `/login?returnUrl=`), `mustChangeGuard` (when `mustChangePassword()` redirects everything except `/change-password`), `adminGuard` (non-admin → forbidden page, not 404 leak of route existence is irrelevant here). Login form: email + password (reactive forms, required/email validators, translated errors, submit disabled while pending, generic failure message "Invalid email or password" for 401 — never reveal which; 429 → "too many attempts, try again later" using `Retry-After` if present). Change-password form: current/new/confirm; new ≥ 12 chars with upper/lower/digit/≤128 mirrored client-side (server is authority); on success keeps session, clears flag, navigates to `returnUrl` or home. Shell: toolbar with app name, nav links (KBs; Admin if admin), user menu (settings, logout), language switcher, `<router-outlet>`; responsive (sidenav collapses on small screens).

- [ ] **Step 1:** Failing tests: `AuthGuard_Anonymous_RedirectsToLoginWithReturnUrl`; `MustChangeGuard_MustChange_RedirectsEverythingExceptChangePassword`; `AdminGuard_NonAdmin_Blocks`; `LoginComponent_ValidCredentials_NavigatesToReturnUrl`; `LoginComponent_401_ShowsGenericMessage_NoFieldHint`; `LoginComponent_429_ShowsRateLimitMessage`; `LoginComponent_MustChangeResponse_GoesToChangePassword`; `ChangePasswordComponent_MismatchedConfirm_ShowsError`; `ChangePasswordComponent_Success_ClearsFlag_AndContinues`; `Shell_Logout_ClearsSessionAndRoutesToLogin`; `Shell_ShowsAdminLinkOnlyForAdmin`; `Login_HasAccessibleLabels` (every input has a label/aria-label; error `role=alert`/`aria-live`).
- [ ] **Step 2:** Run — Expected: FAIL. **Step 3:** Implement; add translation keys in the three JSON files (parity check must stay green).
- [ ] **Step 4:** Run tests/lint/build/i18n:check — Expected: PASS. **Step 5:** Commit `feat(web): shell, routing, guards, login and forced password change`.

### Task 5: Knowledge bases feature (list, create, detail, members)
**Files:**
- Create: `src/app/features/knowledge-bases/{kb.api.ts,kb.models.ts,list/*,detail/*,members/*,create-dialog/*}` + specs; `src/app/shared/{confirm-dialog/*,user-picker/*}`

**Interfaces — Produces:** `KbApi { list(page,pageSize): Observable<Paged<KnowledgeBaseSummary>>; get(id): Observable<{kb: KnowledgeBase; etag: string}>; create(...); update(id, body, etag): Observable<{kb, etag}> (sends `If-Match`); delete(id); members(id); addMember(id,userId,role); changeRole(id,userId,role); removeMember(id,userId); searchUsers(query) }` — shapes taken from `docs/API_DESIGN.md` (read it; do not guess). UX: list with paging, loading/empty/error states, create dialog (name 1–200, description ≤ 2000); detail: rename/description edit (Owner only; sends If-Match; on 412/428 show "changed elsewhere — reload" action; on 404 show NotFound), delete (Owner; confirm dialog; then navigate to list), members tab (all members see list; Owner can add via user picker with 300 ms debounce and min 2 chars, change role, remove; last-owner 409 shows translated message; non-owners see controls disabled/hidden with tooltip); role names translated; ETag handling: re-read after membership changes (the server changes the KB row on membership change).

- [ ] **Step 1:** Failing tests: `KbList_ShowsEmptyState_WhenNoKnowledgeBases`; `KbList_Pages`; `KbCreate_ValidatesNameLength`; `KbDetail_Update_SendsIfMatch_AndStoresNewEtag`; `KbDetail_Update_412_ShowsReloadFlow`; `KbDetail_404_ShowsNotFound_SameAsMissing`; `KbDetail_Viewer_HidesOwnerActions`; `KbDetail_Delete_Confirms_ThenNavigates`; `Members_Add_UsesDebouncedDirectorySearch_MinTwoChars`; `Members_LastOwner409_ShowsTranslatedMessage`; `Members_ChangeRole_And_Remove_RefreshEtag`; `KbName_WithScriptTag_RendersAsText` (no HTML interpretation); `Members_ListShowsNameEmailRole`.
- [ ] **Step 2:** Run — Expected: FAIL. **Step 3:** Implement (standalone components, `OnPush`, signals, Material table/list/dialog/paginator/select/autocomplete); keys added to the three language files.
- [ ] **Step 4:** Run tests/lint/build/i18n:check — Expected: PASS. **Step 5:** Commit `feat(web): knowledge bases and membership UI`.

### Task 6: Admin users feature and settings
**Files:**
- Create: `src/app/features/admin/{users.api.ts,users/*,create-user-dialog/*,temp-password-dialog/*}` + specs; `src/app/features/settings/*`

**Interfaces:** `UsersApi { list(page,pageSize); create({email,displayName,globalRole}): Observable<{id,email,temporaryPassword}>; deactivate(id); resetPassword(id): Observable<{temporaryPassword}> }` (shapes from `docs/API_DESIGN.md`). Temp-password dialog: shows the password once in a read-only field with copy button (clipboard API with fallback message), a warning text, `disableClose` until acknowledged; the value lives only in the dialog component state and is nulled on close (test). Users page: paged table (name, email, role, active, lockout), create, deactivate (confirm; cannot deactivate self → server 409 shown translated), reset password (confirm → temp dialog). Settings page: language selector and link to change password.

- [ ] **Step 1:** Failing tests: `AdminUsers_List_Pages`; `CreateUser_ShowsTemporaryPasswordOnce_AndClearsItOnClose`; `TempPassword_NeverEnters_StorageOrRouterState_OrLogs` (spy console/storage/router state); `CreateUser_DuplicateEmail409_ShowsMessage`; `Deactivate_Self409_ShowsMessage`; `ResetPassword_ShowsTempDialog`; `AdminRoute_NonAdmin_Forbidden`; `UserDisplayName_WithHtml_RendersAsText`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement; translations. **Step 4:** tests/lint/build/i18n:check — PASS. **Step 5:** Commit `feat(web): admin user management and settings`.

### Task 7: Quality pass, docs and verification
**Files:**
- Create: `docs/FRONTEND.md`, `docs/ARCHITECTURE_DECISIONS/0005-angular-client-auth-and-i18n.md`
- Modify: `docs/INFRASTRUCTURE.md`, `docs/PROJECT_PROGRESS.md`, `frontend/enterprise-rag-web/README.md`

- [ ] **Step 1:** Add a Content-Security-Policy recommendation (documented, to be applied at the web server in Phase 11; verify the built app has no inline script/eval that would block `script-src 'self'`), run `npm audit --omit=dev --audit-level=high`, `npm run lint`, `npm run test:ci`, `npm run build` (prod) — record real counts/bundle size; record the no-unsafe-HTML guard result.
- [ ] **Step 2:** Manual end-to-end against the real API: start Compose SQL + migrate (`docs/INFRASTRUCTURE.md`), start the API in Release from its project directory with the documented env vars, `npm start`, then via `curl` through the dev-server proxy (`http://localhost:4200/api/...`) verify: `/health/ready` 200 via proxy; login of the seeded admin through the proxy returns the `Set-Cookie` with `Secure`/`HttpOnly`; static app shell served; and record that **UI click-through (login → forced password change → create KB → members → admin → language switch incl. RTL) could not be driven without a browser and must be confirmed by the user**, unless a browser-automation tool is available to the executor (if available, drive it and record).
- [ ] **Step 3:** Docs: `FRONTEND.md` (structure, auth/token model, interceptor flow diagram, i18n/RTL how-to-add-a-language, testing, commands), ADR 0005 (Angular 22 + Material, in-memory token + cookie refresh, runtime i18n choice and why, proxy/no-CORS decision, CSP plan), update INFRASTRUCTURE (dev run), PROJECT_PROGRESS (Phase 2b complete pending review; honest verification; known issues: CI frontend job unrun on GitHub, UI click-through unverified if so, deferred items).
- [ ] **Step 4:** Commit `docs: phase 2b complete (pending review)`.

---
## Self-review notes
- Spec coverage: §11c-6 languages ar/en/de + RTL ✓ T2/T4; §8 no tokens in storage ✓ T3; forced password change (server-enforced in 2a) ✓ T4; KB sharing UX ✓ T5; admin-created users ✓ T6; docs ✓ T7. Deferred to later phases: documents UI (Phase 3), chat (Phase 4–5), notifications/PWA (Phases 8–9), leave-KB and admin assign-owner (backend additions; plan with Phase 3).
- Type consistency: `AuthStore`/`AuthService`/`ApiError`/`KbApi`/`UsersApi` names used identically in Tasks 3–6; `PROBLEM_TYPES` from the server's documented URIs.
- Risk: Angular 22 + library peer-dependency mismatches (Transloco/Material); implementer must verify and report rather than force-install (`--force`/`--legacy-peer-deps` need controller approval).
