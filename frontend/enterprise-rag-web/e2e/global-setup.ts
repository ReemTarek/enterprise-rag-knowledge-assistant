import { FullConfig, chromium, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { ApiClient } from './support/api';
import { ADMIN_STATE_CLAIM_FILE, ADMIN_STATE_FILE, AUTH_DIR, loadEnv } from './support/env';

const READY_TIMEOUT_MS = 30_000;

async function waitForApiReady(apiUrl: string): Promise<void> {
  const url = `${apiUrl}/health/ready`;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.status === 200) return;
      last = `HTTP ${res.status}`;
    } catch (error) {
      last =
        error instanceof Error
          ? error.cause instanceof Error
            ? error.cause.message
            : error.message
          : 'error';
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `\n\nE2E: the API is not ready: GET ${url} did not answer 200 within ${READY_TIMEOUT_MS / 1000} s (last: ${last}).\n` +
      'The E2E suite runs against the real API and SQL Server. Start them in another shell with\n\n' +
      '    npm run e2e:stack\n\n' +
      'wait for "stack ready", then rerun `npm run e2e`. (CI starts the API in its own steps; set E2E_API_URL if the\n' +
      'API listens elsewhere.)\n',
  );
}

/**
 * Makes the E2E admin usable, idempotently: sign in with the NEW password first (already changed by an earlier run);
 * if rejected, sign in with the seeded password and change it. Throws a clear error when neither works.
 */
async function ensureAdminPassword(api: ApiClient): Promise<void> {
  const env = loadEnv();
  const withNew = await api.tryLogin(env.adminEmail, env.adminNewPassword);
  if (withNew.session) {
    if (withNew.session.mustChangePassword) {
      throw new Error(
        `E2E admin ${env.adminEmail} must change the password again (reset by an admin?). Use --fresh.`,
      );
    }
    return;
  }
  if (withNew.status !== 401)
    throw new Error(`E2E admin login failed with HTTP ${withNew.status}.`);

  const withSeed = await api.tryLogin(env.adminEmail, env.adminPassword);
  if (!withSeed.session) {
    throw new Error(
      `\n\nE2E: cannot sign in as ${env.adminEmail} with either the new or the seeded password (HTTP ${withSeed.status}).\n` +
        'The API seeds the admin only into an EMPTY Users table, so a database from another run/developer keeps its\n' +
        'own admin. Recreate it: stop the stack and run `npm run e2e:stack -- --fresh` (drops the SQL data volume).\n',
    );
  }
  await api.changePassword(env.adminPassword, env.adminNewPassword);
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const env = loadEnv();
  // One id per run: generated emails/names stay unique across reruns against the same database.
  process.env['E2E_RUN_ID'] ||= `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;

  await waitForApiReady(env.apiUrl);

  mkdirSync(AUTH_DIR, { recursive: true });
  rmSync(ADMIN_STATE_FILE, { force: true });
  rmSync(ADMIN_STATE_CLAIM_FILE, { force: true });

  // Sign in inside a real browser context against the proxy origin, so the refresh cookie (Secure; SameSite=Strict;
  // Path=/api/auth) is stored for `localhost` exactly as the app stores it. One login per run (rate limit 10/min).
  const browser = await chromium.launch();
  try {
    const baseURL = config.projects[0]?.use.baseURL ?? env.baseUrl;
    const context = await browser.newContext({ baseURL });
    const api = new ApiClient(context.request);
    await ensureAdminPassword(api);

    // Prove the saved session works in the app (restores through the refresh cookie, no login page), then save the
    // state AFTER this page load, because the load rotated the cookie.
    const page = await context.newPage();
    await page.goto('/knowledge-bases');
    await expect(
      page.getByRole('heading', { level: 1 }),
      'admin session restores from the refresh cookie',
    ).toBeVisible({
      timeout: 30_000,
    });
    if (new URL(page.url()).pathname !== '/knowledge-bases') {
      throw new Error(`E2E admin session did not restore: landed on ${page.url()}.`);
    }
    const state = await context.storageState();
    if (!state.cookies.some((c) => c.name === 'refresh_token')) {
      throw new Error('E2E admin session has no refresh_token cookie for the app origin.');
    }
    writeFileSync(ADMIN_STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
    await context.close();
  } finally {
    await browser.close();
  }
}
