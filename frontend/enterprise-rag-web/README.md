# enterprise-rag-web

Angular 22 client (standalone components, SCSS, Angular Material, zoneless, Vitest + jsdom).

## Commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Install locked dependencies |
| `npm start` | Dev server (http://localhost:4200) with the API proxy |
| `npm run test:ci` | Single non-interactive test run |
| `npm run lint` | angular-eslint + `scripts/check-no-unsafe.mjs` + guard self-test |
| `npm run test:guard` | Self-test of the unsafe-pattern guard |
| `npm run build` | Production build into `dist/` |
| `npm run e2e:stack` | Start SQL (Docker) + migrations + API in Release for E2E; keep it running |
| `npm run e2e` | Playwright E2E suite (starts `npm start` itself; needs `e2e:stack`) |
| `npm run e2e:report` | Open the last HTML report |

## E2E tests

Full-stack Playwright specs live in `e2e/` (Chromium; `@axe-core/playwright` for accessibility).
Prerequisites: Docker Desktop running, the .NET SDK (`global.json`), Node 24/26, `npm ci`, and once
`npx playwright install chromium`.

```bash
npm run e2e:stack              # shell 1: wait for "stack ready" (Ctrl+C stops the API)
npm run e2e                    # shell 2: whole suite
npm run e2e -- e2e/smoke.spec.ts
npx playwright test --ui       # debug: UI mode; failing tests keep traces in test-results/
npm run e2e:report             # HTML report
```

Credentials are generated per machine into the git-ignored `e2e/.auth/stack.env.json` (never printed); override with
`E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, `E2E_ADMIN_NEW_PASSWORD`, `E2E_BASE_URL`, `E2E_API_URL`. `npm run e2e:stack --
--fresh` recreates the SQL volume (deletes all local SQL data) when the stored credentials no longer match the database.
Read `docs/FRONTEND.md` "E2E tests" before writing specs: the refresh cookie rotates (never share one `storageState`
between tests; use the fixtures) and the API rate limits (login 10/min/IP) apply to the whole suite.

## API proxy

`proxy.conf.json` forwards `/api` and `/health` to `http://127.0.0.1:5180` (the API's launch-profile port).
To use a different API, edit the `target` values, or copy the file and run
`npx ng serve --proxy-config my-proxy.json`.

## i18n

Runtime translations use `@jsverse/transloco`; files live in `src/assets/i18n/{en,de,ar}.json` (nested `feature.section.key`, parameters as `{{name}}`).
Arabic switches `<html dir>` to `rtl`; write CSS with logical properties (`margin-inline-start`, `padding-inline-end`, ...).

- **Add a key:** add it to all three files, then use `{{ 'feature.section.key' | transloco }}` (or `transloco: { name: value }` for params).
  `npm run i18n:check` (part of `lint`) and the `Translations_*` unit tests fail if keys, values or placeholders differ.
- **Add a language:** add the code to `SUPPORTED_LANGUAGES` (and `RTL_LANGUAGES` if right-to-left) in `core/i18n/language.service.ts`,
  create `src/assets/i18n/<code>.json`, add it to `langs` in `scripts/check-i18n-parity.mjs`, and add `language.name.<code>` to every file.
- The chosen language (only) is stored in `localStorage['lang']`.

## More

Architecture, auth flow, CSP plan and the manual verification checklist: `docs/FRONTEND.md`; decisions: `docs/ARCHITECTURE_DECISIONS/0005-angular-client-auth-and-i18n.md`.
