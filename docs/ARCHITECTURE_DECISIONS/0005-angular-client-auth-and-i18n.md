# 0005 Angular client: stack, authentication and i18n

Status: accepted (Phase 2b)

## Context
Phase 2b adds the browser client for the Phase 2a API (ADR 0004: JWT access token, rotating `HttpOnly` refresh cookie,
server-enforced must-change-password, no CORS). The spec requires Arabic, English and German with RTL, and the security
design forbids tokens in web storage.

## Decision
- **Angular 22 (standalone, zoneless, signals), Angular Material, Vitest.** Zoneless matches the current Angular
  default and keeps change detection explicit; Material gives accessible components (dialogs, tables, menus, paginator)
  with RTL support; Vitest (the CLI default runner) with jsdom runs headless in CI. Library versions were taken as
  published; no `--force` or `--legacy-peer-deps` was needed.
- **Access token in memory, refresh through the HttpOnly cookie, single-flight refresh.** The token is a private field of
  `AuthStore` with no signal or storage; a reload restores the session through `POST /api/auth/refresh` at startup. The
  interceptor refreshes once on 401 and retries once; concurrent 401s share one refresh (important because refresh
  tokens rotate and reuse revokes the family). Only a refresh rejected with 400/401/403 ends the session; network
  errors, 429 and 5xx keep it and surface the refresh's own error (the refresh rate limit is per IP and shared behind a
  proxy, so treating those as "signed out" would log users out at random). Logout clears the store synchronously and
  revokes server-side best effort (5 s timeout); a session generation counter in `AuthStore` makes a token that
  arrives after logout be dropped instead of signing the client back in. A lint guard bans tokens or passwords in web storage, `innerHTML`,
  `bypassSecurityTrust*` and `eval(`. Cost: a tab reload costs one refresh call, and XSS could still use the in-memory
  token during its lifetime (mitigated by Angular's template escaping, the guard and the planned CSP).
- **Runtime i18n with Transloco, not compile-time `@angular/localize`.** Compile-time i18n builds one bundle per locale
  and needs a URL or deployment per language; the product wants users to switch language in the running app (including
  the login page) and to switch `dir` at runtime. Transloco loads a JSON file per language lazily, supports params,
  and is easy to test and to check for key parity (`i18n:check`, unit tests). Cost: strings are looked up at runtime (a
  missing key shows the key; parity checks mitigate) and no ICU extraction tooling.
- **Same-origin dev proxy, no CORS.** `proxy.conf.json` forwards `/api` and `/health`, so the `SameSite=Strict` cookie
  works and no CORS policy exists. Production plan (Phase 11): a reverse proxy serves the static client and `/api` on
  one origin and sets the security headers including the CSP (see `docs/FRONTEND.md`). CORS with credentials stays a
  deliberate, reviewed change if a separate origin is ever needed.
- **`returnUrl` sanitisation.** After login or password change the app navigates only to an in-app path: it must start
  with a single `/`, may not start with `//` or `/\`, and is applied with `navigateByUrl`. This prevents open
  redirects through `?returnUrl=`.
- **`ApiError` mapping by problem `type`.** The server's stable `type` URIs (`PROBLEM_TYPES`; a `test:guard` script
  compares them with `src/EnterpriseRag.API/Http/ProblemTypes.cs` read from the repository and skips if that file is
  absent; the unit test only compares against a hand-copied list) select a translation key (`messageKeyFor`). The server `detail` and status text are never displayed; the
  correlation id is shown for 5xx only. Unknown types fall back to a generic message.
- **Temporary password shown once.** Admin create/reset returns a temporary password a single time. The dialog is not
  dismissable (no Escape, no backdrop click, `closeOnNavigation: false` so the Back button cannot discard it unseen),
  offers copy, and the value is not stored or logged.
- **Forced password change mirrored in the client**, enforced by the server: `mustChangeGuard` covers every signed-in
  child route and the interceptor reacts to 403 `password-change-required`. The client password policy uses the same
  ASCII character classes as the server.

## Consequences
- Language, RTL and theme logic live in the client; the server only returns codes and types.
- Every new user-visible string must be added to three files; CI fails otherwise.
- The initial bundle is about 547 kB raw / 132 kB transfer, the baseline for Angular + Material + Transloco with every
  feature lazy; the initial warning budget is 600 kB (error 1 MB) and is revisited when exceeded.
- The built `index.html` has an inline script (critical-CSS loader) and inline styles, and fonts come from Google (see
  "Decision recorded" below).

## Decision recorded: self-hosted fonts, no inline loader script
The app currently depends on Google Fonts at runtime (`fonts.googleapis.com` / `fonts.gstatic.com` for Roboto and
Material Symbols) and at build time (the production build inlines the Google Fonts CSS), and the production
`index.html` contains an inline critical-CSS loader script. GDPR (German users; the visitor's IP goes to Google), a
strict CSP (`script-src 'self'`, `font-src 'self'`), PWA/offline use and Arabic glyph coverage all require self-hosting:
`@fontsource/roboto`, `material-symbols` and optionally Noto Sans Arabic from npm; remove the Google `<link>`s; set
`optimization.styles.inlineCritical: false` and `optimization.fonts: false`; and call
`MatIconRegistry.setDefaultFontSetClass('material-symbols-outlined', 'mat-ligature-font')`. This is the **first task of
Phase 3 and must be done before any non-dev deployment**; it is not implemented in Phase 2b. Details in
`docs/FRONTEND.md`.
- Authorization stays on the server; client guards (`adminGuard`, `mustChangeGuard`) are usability only.
- No native-speaker review of Arabic and German has been done.

## E2E strategy (Phase 2b hardening)
- **Full-stack Playwright, not a mocked UI.** `@playwright/test` (Chromium desktop + a Pixel 7 project for `@mobile`
  specs) drives the real chain: SQL Server -> migrated database -> API in Release -> Angular dev server with the
  same-origin proxy. Network interception (`page.route`) is used only to simulate an unreachable API/gateway (D8).
  Accessibility is checked with `@axe-core/playwright` (serious/critical violations fail). Reason: the defects found by
  the real-browser verification (layout, focus, bidi, cross-tab logout, proxy errors) live between the client, the
  cookie/refresh protocol and the server, where unit tests with mocks cannot see them.
- **Test data only through the public API.** Global setup signs in the seeded admin and performs the forced password
  change through the API; fixtures create users (temporary password changed via the API) and knowledge bases with
  per-run/per-worker unique names. Nothing writes to the database directly, so the suite also exercises the API
  contract and needs no knowledge of the schema.
- **Per-worker admin session chain.** The refresh cookie rotates on every use and reuse revokes the session family, so
  a saved `storageState` can only be continued by one chain of contexts: the first worker takes over the global-setup
  state, other workers sign in once, and the rotated state is carried from test to test. Tests that sign out or change
  passwords use their own users.
- **Raised auth rate limits only in E2E.** All clients of the suite share one IP, so the per-IP limits (login 10/min,
  refresh 30/min) were made configurable (`RateLimit:*`, validated; defaults unchanged) and `e2e-stack` sets 1000/3000
  for the API it starts. Production and the API integration tests keep the defaults.
- **Fresh database per CI run.** The CI job uses an ephemeral SQL Server service container (see
  `docs/INFRASTRUCTURE.md`), so runs are independent; locally a dedicated `EnterpriseRagE2e` database keeps the
  developer's data untouched, and specs never rely on an empty database.
- Consequences: the suite needs Docker (local) and takes about a minute locally (2 workers); retries are capped at 1 in
  CI and flakes are fixed rather than hidden; one known gap is a `test.fixme` (change-password 502 message).
