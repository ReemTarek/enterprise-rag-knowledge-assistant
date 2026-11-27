import { defineConfig, devices } from '@playwright/test';

/**
 * Full-stack E2E: Chromium -> Angular dev server (started here, `npm start`, proxy to the API) -> real API -> SQL.
 * The API and SQL Server are NOT started by Playwright: run `npm run e2e:stack` locally (CI starts them in its own
 * steps). Global setup fails fast with instructions when the API is not ready. See docs/FRONTEND.md "E2E tests".
 *
 * Tags: tests tagged `@mobile` run only in `chromium-mobile` (responsive/shell specs); everything else runs only in
 * `chromium` (desktop).
 */
const baseURL = process.env['E2E_BASE_URL'] || 'http://localhost:4200';
const ci = !!process.env['CI'];

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  // 2 workers everywhere on purpose: every client shares the API's per-IP rate limits (login 10/min, refresh
  // 30/min) and each worker costs admin sign-ins. E2E_WORKERS overrides (e.g. 1 while debugging).
  workers: Number(process.env['E2E_WORKERS'] || 2),
  // Generous because test-data setup waits out a 429 window (Retry-After) instead of failing.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      grepInvert: /@mobile/,
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 7'] },
      grep: /@mobile/,
    },
  ],
  webServer: {
    command: 'npm start',
    url: baseURL,
    reuseExistingServer: !ci,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
