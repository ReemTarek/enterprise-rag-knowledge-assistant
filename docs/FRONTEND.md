# Frontend (Angular client)

## Purpose
`frontend/enterprise-rag-web` is the browser client of Enterprise RAG. Phase 2b delivers the shell and everything the
Phase 2a API offers: sign-in, forced password change, knowledge bases with membership, admin user management, and
Arabic / English / German with right-to-left layout. Documents (Phase 3) and chat (Phases 4-5) are not built yet.

Stack: Angular 22.3 (standalone components, zoneless change detection, signals), Angular Material, SCSS,
`@jsverse/transloco` (runtime i18n), Vitest + jsdom for tests, angular-eslint.

## Folder structure (`frontend/enterprise-rag-web/src`)
```
app/
  core/
    api/         ApiClientService (typed HTTP + ETag/If-Match helpers), ApiError, problem types, messageKeyFor
    auth/        AuthStore (in-memory token + user signals), AuthService, authInterceptor, guards
    i18n/        LanguageService (ar/en/de, dir switching), transloco providers, locale data
    navigation/  safe-return-url (returnUrl sanitiser), AppTitleStrategy (route titles are translation keys)
  layout/shell/  toolbar, navigation, language switcher, outlet for signed-in pages
  features/
    auth/        login, change-password
    knowledge-bases/  list, create dialog, detail (+ members tab, role changes, user picker)
    admin/       users table, create-user dialog, one-time temporary-password dialog
    settings/    language and account page
  shared/        confirm dialog, error banner, language switcher, user picker, forbidden, not-found
assets/i18n/     en.json, de.json, ar.json
scripts/         check-no-unsafe.mjs (+ self-test), check-i18n-parity.mjs
proxy.conf.json  dev-server proxy for /api and /health
```

## Auth and token model
- The **access token (JWT, 15 min) lives only in memory** (`AuthStore`, a private field; the store exposes no token
  signal). Nothing is written to `localStorage`, `sessionStorage` or IndexedDB; the lint guard fails the build if a
  token or password is put in web storage. The only persisted value is the chosen language (`localStorage['lang']`).
- The **refresh token is an `HttpOnly; Secure; SameSite=Strict; Path=/api/auth` cookie** set by the server. JavaScript
  never sees it. After a page reload the app calls `POST /api/auth/refresh` (cookie sent by the browser) in an app
  initializer (`restoreSession`) to get a new access token.
- All `/api/*` calls go through `authInterceptor`, which adds the bearer header, refreshes once on 401 and retries
  once. Concurrent 401s share one refresh request (single-flight inside `AuthService.refresh`).

```
request /api/x  ->  interceptor: not /api/ ?  -> pass through untouched (assets, i18n json)
                    attach Authorization: Bearer <in-memory token>  (not for login/refresh/logout)
                         |
                    server answers
   2xx -------------------+--------> deliver
   401 (had a token) -----+--> already retried once? -> end session -> /login?returnUrl=...
                          |      token already replaced by another refresh? -> retry with the new token
                          |      else AuthService.refresh()  (single-flight: all waiting requests share it)
                          |          refresh ok  -> retry request once with the new token
                          |          refresh bad -> end session -> /login?returnUrl=...
   403 password-change-required -> AuthStore.mustChangePassword = true -> /change-password
   other 4xx/5xx/network --------> mapped to ApiError and rethrown (components show messageKeyFor(error))
```

## Forced password change
The seeded admin and every admin-created or admin-reset user have `mustChangePassword = true`. The server enforces it
(every endpoint except `POST /api/auth/password`, `GET /api/me` and the auth endpoints returns 403
`password-change-required`); the client mirrors it so the user is never shown pages that cannot work.
1. Login response carries `mustChangePassword: true`; `AuthStore` records it.
2. `mustChangeGuard` (on the signed-in parent route's `canActivateChild`) redirects every child except
   `/change-password` there, including `/admin`, `/settings`, `/forbidden` and unknown URLs. This is pinned by
   router-level tests.
3. The change form applies the same password policy as the server (12-128 characters, ASCII upper/lower/digit), calls
   `POST /api/auth/password`, then clears the flag and navigates to the sanitised `returnUrl` or `/`.
4. If the server answers 403 password-change-required for any call, the interceptor sets the flag and navigates to
   `/change-password`.

## i18n and RTL
- Runtime translations (Transloco); the language can change without a rebuild. Files: `src/assets/i18n/{en,de,ar}.json`,
  nested keys (`feature.section.key`), parameters `{{name}}`. Route titles are keys resolved by `AppTitleStrategy`.
- `LanguageService` sets `<html lang>` and `<html dir>` (`rtl` for Arabic) and registers Angular locale data; styles use
  logical properties (`margin-inline-start`, ...) so layout flips without separate CSS.
- **Add a key:** add it to all three files, use `{{ 'a.b.c' | transloco }}`. `npm run i18n:check` (part of `lint`) and the
  `Translations_*` unit tests fail on a missing key, empty value or placeholder mismatch (the parity check).
- **Add a language:** add the code to `SUPPORTED_LANGUAGES` (and `RTL_LANGUAGES` if right-to-left) in
  `core/i18n/language.service.ts`, create `assets/i18n/<code>.json`, add it to `langs` in
  `scripts/check-i18n-parity.mjs`, add `language.name.<code>` to every file, and register locale data if dates or numbers
  are formatted.
- **Rule:** no user-visible English literals in templates or TypeScript; everything goes through translation keys.
  Server `detail` text is never shown; messages are chosen from the problem `type`.

## Routing and guards
| Path | Guard(s) | Notes |
|---|---|---|
| `/login` | `anonymousGuard` | signed-in users are redirected away |
| `` (shell, all children below) | `authGuard` (canActivate), `mustChangeGuard` (canActivateChild) | redirect `/` -> `/knowledge-bases` |
| `/change-password` | (inside shell) | the only child reachable while a change is due |
| `/knowledge-bases`, `/knowledge-bases/:id` | (inside shell) | lazy; members tab, role change, remove |
| `/admin/users` | `adminGuard` | lazy; Admin role only (server still enforces) |
| `/settings` | (inside shell) | language and account |
| `/forbidden`, `**` | (inside shell) | 403 and 404 pages |

`returnUrl` is sanitised (`safe-return-url.ts`): only paths starting with a single `/`, rejecting `//`, `/\` and
absolute URLs; navigation uses `navigateByUrl`.

## Error handling
The interceptor converts every `HttpErrorResponse` to an `ApiError` (`status`, `type`, `title`, `correlationId`, field
`errors`, `isPasswordChangeRequired`). Network failures get a synthetic `NETWORK_ERROR_TYPE`. `PROBLEM_TYPES` lists the
server's problem-type URIs (kept in sync with `src/EnterpriseRag.API/Http/ProblemTypes.cs` by a unit test). Components call
`messageKeyFor(error)` to get a translation key (`errors.validation`, `errors.notFound`, `errors.conflict`, ...) and show
it through the shared error banner; for 5xx the correlation id is shown so support can find the server log. `409`
(conflict), `412` (stale `If-Match`) and `428` (missing precondition) have distinct messages.

## Testing
- `npm run test:ci` - single run, Vitest + jsdom, 28 files / 200 tests (Task 7 run). Component specs use
  `HttpTestingController`; guards and the interceptor are also tested on the real router (`RouterTestingHarness`);
  dialogs that must not be dismissable are pinned (the Escape key is dispatched on `body`, where CDK listens).
- `npm run lint` - `ng lint` (angular-eslint), `check:unsafe` (bans `innerHTML`, `bypassSecurityTrust*`, `eval(`, tokens
  or passwords in web storage), `test:guard` (the guard's own 10 self-tests), `i18n:check`.
- `npm run build` - production build. `npm audit --omit=dev --audit-level=high` should report no high issues.
- CI job `frontend` (`.github/workflows/ci.yml`) runs `npm ci`, lint, test:ci, build on Node 24.x. **It has not run on
  GitHub yet.**

## Bundle and budget status
Production build (Task 7): initial 546.99 kB raw / 132.24 kB transfer (main 538.94 kB + styles 8.04 kB), against a
500 kB warning budget (1 MB error budget). This is a **warning only**; the budget was not changed. Lazy chunks
(raw): 84.59, kb-detail 82.11, 74.69, 73.86, users 49.48, 44.80, settings 24.22, 21.05, kb-list 11.08, change-password
6.85, login 4.59 kB and smaller ones (20 lazy chunks in total). Options: raise `maximumWarning` to about 600 kB with a
justification, or move more of the shell/Material usage behind lazy routes.

## Content-Security-Policy plan (applied at the web server in Phase 11; document only)
Inspection of `dist/enterprise-rag-web/browser/index.html` (production build):
- **One inline `<script>`** is emitted by Angular's critical-CSS inlining (Beasties): it flips the `media` attribute of
  the deferred stylesheet. It violates `script-src 'self'`. Options: disable `inlineCritical` for the production
  optimization (`"optimization": {"styles": {"inlineCritical": false}}`), or allow it by hash or nonce (a static hash is
  fine because the script text is constant, but re-check it after Angular upgrades; a per-response nonce needs the
  server to rewrite `index.html` and `ngCspNonce`). The main bundle is `<script type="module" src>` (same origin).
- **Inline `<style>` blocks** exist (critical CSS, Material system tokens, and the Google Fonts CSS that the build inlines).
  Material also sets inline styles at runtime. Use `style-src 'self' 'unsafe-inline'` (the practical baseline for
  Angular Material), or nonces with `ngCspNonce` as a later hardening step.
- **Google Fonts:** the build inlines the font CSS but the font files are loaded from `https://fonts.gstatic.com`, with
  `preconnect` to `fonts.googleapis.com`. Either allow `font-src https://fonts.gstatic.com` or (recommended, also better
  for privacy and offline use) self-host Roboto and Material Symbols and keep `font-src 'self'`.
- No `eval`, `new Function` or `unsafe-eval` is needed by the built bundle (no `eval(` found in `dist`).

Recommended header (adjust after the decisions above):
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self';
  frame-ancestors 'none'; form-action 'self'
```
plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. Verify in a real browser
(console CSP violations) before rollout.

## Dev proxy and why there is no CORS
The API configures no CORS. `proxy.conf.json` makes the dev server forward `/api` and `/health` to
`http://127.0.0.1:5180`, so the browser sees one origin (`http://localhost:4200`). Reasons: the refresh cookie is
`SameSite=Strict` and would not travel cross-site, and CORS with credentials is an extra attack surface. Production
uses the same shape (a reverse proxy serving the static client and `/api` on one origin, Phase 11). The `Secure` cookie
works on `http://localhost` in browsers (localhost is treated as a secure context); curl does not resend it over http,
so pass it by hand (`-H "Cookie: refresh_token=..."`).

## Known limitations
- Initial bundle above the warning budget; CSP not yet applied; fonts are loaded from Google.
- Arabic and German translations were not reviewed by native speakers; the Material menu in RTL was not visually verified.
- `Retry-After` on 429 is not surfaced (generic message).
- Users cannot leave a knowledge base and admins cannot assign an owner (no server endpoints; planned with Phase 3).
- UI click-through in a real browser has **not** been performed by the author (see checklist below).
- The deferred per-task review items are listed in `docs/PROJECT_PROGRESS.md`.

## User manual checklist (visual verification)
Start Compose SQL, migrate, run the API, run `npm start` (see `docs/INFRASTRUCTURE.md`), open http://localhost:4200.
1. Login page renders in English; wrong password shows an error; the seeded admin signs in.
2. Forced change: redirected to `/change-password`; typing `/knowledge-bases`, `/admin`, `/settings` in the URL bar returns to it;
   a weak password is rejected client-side; a strong one succeeds and lands on knowledge bases. Reload: still signed in.
3. Create a knowledge base (dialog; Escape/Cancel work); it appears in the list; open it; edit name/description;
   saving twice from two tabs shows the stale-version (412) message.
4. Members tab: add a user via the picker (type 2+ characters), change a role, remove a member; the last owner cannot be removed.
5. Admin > Users: create a user (temporary password dialog shows once, cannot be dismissed with Escape or backdrop,
   Copy works, and it survives the browser Back button until acknowledged); reset password; deactivate; paging.
6. Language switch en -> de -> ar: text changes, no raw keys (`some.key.name`) visible; in Arabic `html` has `dir="rtl"`,
   toolbar, tables, dialogs, paginator and menus are mirrored, icons with direction (arrows, chevrons) point correctly,
   numbers and dates look right; reload keeps the language.
7. Keyboard only: Tab order is logical, focus is visible, dialogs trap focus and return it to the opener, menus open
   with Enter/Space and close with Escape, no keyboard trap in the shell.
8. Screen reader spot checks (NVDA or VoiceOver) in Arabic and English: form fields have labels and error text is
   announced, the language switcher and nav have names, dialog titles are read on open, the copy button announces its result.
9. Browser devtools: Application > Storage has no token or password; the `refresh_token` cookie is HttpOnly, Secure,
   SameSite=Strict, path `/api/auth`; no console errors.
10. Narrow window (about 360 px): navigation collapses to a menu and tables remain usable.
