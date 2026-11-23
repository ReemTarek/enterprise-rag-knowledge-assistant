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
  tokens rotate and reuse revokes the family). A lint guard bans tokens or passwords in web storage, `innerHTML`,
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
- **`ApiError` mapping by problem `type`.** The server's stable `type` URIs (`PROBLEM_TYPES`, tested against the server
  list) select a translation key (`messageKeyFor`). The server `detail` and status text are never displayed; the
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
- The initial bundle is 547 kB (warning budget 500 kB); lazy routes keep feature code out of it. Raising the warning
  budget or trimming the shell is open.
- The built `index.html` has an inline script (critical-CSS loader) and inline styles; the CSP must use a hash, disable
  critical CSS inlining, or accept the trade-off (details in `docs/FRONTEND.md`). Fonts currently come from Google; self-hosting
  is recommended before Phase 11.
- Authorization stays on the server; client guards (`adminGuard`, `mustChangeGuard`) are usability only.
- No native-speaker review of Arabic and German has been done.
