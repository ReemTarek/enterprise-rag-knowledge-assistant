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
