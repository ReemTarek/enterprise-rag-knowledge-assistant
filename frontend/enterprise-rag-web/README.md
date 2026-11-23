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
