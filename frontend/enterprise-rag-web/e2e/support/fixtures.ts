import {
  BrowserContext,
  BrowserContextOptions,
  Page,
  TestInfo,
  expect,
  test as base,
} from '@playwright/test';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { ApiClient, GlobalRole, KnowledgeBase } from './api';
import { ADMIN_STATE_CLAIM_FILE, ADMIN_STATE_FILE, loadEnv } from './env';
import { ActiveUser, SessionState, UserCredentials, createActiveUser, newApiClient } from './users';

export { expect };

/**
 * Session model (why not a plain `storageState` per test): the refresh cookie ROTATES on every use and presenting an
 * already-rotated one is treated as theft (the whole session family is revoked). So one saved state can be used by
 * one chain of contexts only, one after the other. Each worker keeps such a chain for the admin: the first worker
 * takes over the state saved by global setup (no extra login), other workers sign in once; after every test the
 * rotated state is read back from the context and handed to the next test. A test that signs out (or fails) breaks
 * the chain, and the next test signs in again. This keeps the suite far below the login limit (10/min/IP).
 */
interface AdminChain {
  state: SessionState | undefined;
}

interface WorkerFixtures {
  adminChain: AdminChain;
  /** Admin API client (bearer), signed in once per worker; independent of the browser sessions. */
  adminApi: ApiClient;
}

export interface KbFactory {
  /** Creates a knowledge base owned by the caller of `api` (unique name suffix unless `exact`). */
  create(
    api: ApiClient,
    name?: string,
    options?: { description?: string; exact?: boolean },
  ): Promise<KnowledgeBase>;
}

interface TestFixtures {
  /** A page in its own context, signed in as the E2E admin (password already changed by global setup). */
  adminPage: Page;
  /** Creates an active user through the admin API (temp password -> forced change done). */
  newUser: (options?: { role?: GlobalRole; displayName?: string }) => Promise<ActiveUser>;
  /** Same as `newUser`, under the name used in the plan (`userFactory.create({ role })`). */
  userFactory: {
    create: (options?: { role?: GlobalRole; displayName?: string }) => Promise<ActiveUser>;
  };
  /** A new browser context signed in as `user` (reuses the user's creation session once, else signs in). */
  asUser: (user: UserCredentials | ActiveUser) => Promise<Page>;
  /** An API client signed in as `user` (one login permit). */
  apiAs: (user: UserCredentials) => Promise<ApiClient>;
  kbFactory: KbFactory;
}

function contextOptions(testInfo: TestInfo, storageState?: SessionState): BrowserContextOptions {
  const u = testInfo.project.use;
  return {
    baseURL: u.baseURL,
    viewport: u.viewport,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    userAgent: u.userAgent,
    locale: u.locale,
    timezoneId: u.timezoneId,
    colorScheme: u.colorScheme,
    storageState,
  };
}

function hasRefreshCookie(state: SessionState | undefined): boolean {
  return !!state?.cookies.some((c) => c.name === 'refresh_token' && c.value);
}

/** The first worker to get here takes over the global-setup state; the claim file makes that exclusive. */
function claimGlobalSetupState(): SessionState | undefined {
  if (!existsSync(ADMIN_STATE_FILE)) return undefined;
  try {
    closeSync(openSync(ADMIN_STATE_CLAIM_FILE, 'wx'));
  } catch {
    return undefined; // another worker owns it
  }
  return JSON.parse(readFileSync(ADMIN_STATE_FILE, 'utf8')) as SessionState;
}

async function signIn(email: string, password: string): Promise<SessionState> {
  const client = await newApiClient();
  try {
    const session = await client.login(email, password);
    if (session.mustChangePassword) throw new Error(`${email} must still change the password.`);
    return await client.request.storageState();
  } finally {
    await client.request.dispose();
  }
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  adminChain: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use({ state: claimGlobalSetupState() });
    },
    { scope: 'worker' },
  ],

  adminApi: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const env = loadEnv();
      const api = await newApiClient();
      await api.login(env.adminEmail, env.adminNewPassword);
      await use(api);
      await api.request.dispose();
    },
    { scope: 'worker' },
  ],

  adminPage: async ({ browser, adminChain }, use, testInfo) => {
    const env = loadEnv();
    if (!hasRefreshCookie(adminChain.state)) {
      adminChain.state = await signIn(env.adminEmail, env.adminNewPassword);
    }
    const context = await browser.newContext(contextOptions(testInfo, adminChain.state));
    adminChain.state = undefined; // in use: only this context may present the cookie now
    const page = await context.newPage();
    await use(page);
    // Hand the rotated cookie to the next test, unless the session is gone (signed out) or the test failed mid-way.
    const passed = testInfo.status === testInfo.expectedStatus;
    const state = await context.storageState();
    adminChain.state = passed && hasRefreshCookie(state) ? state : undefined;
    await context.close();
  },

  newUser: async ({ adminApi }, use) => {
    await use((options) => createActiveUser(adminApi, options));
  },

  userFactory: async ({ newUser }, use) => {
    await use({ create: newUser });
  },

  asUser: async ({ browser }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    const used = new WeakSet<object>();
    await use(async (user) => {
      let state: SessionState;
      if ('session' in user && !used.has(user.session)) {
        used.add(user.session);
        state = user.session;
      } else {
        state = await signIn(user.email, user.password);
      }
      const context = await browser.newContext(contextOptions(testInfo, state));
      contexts.push(context);
      return context.newPage();
    });
    await Promise.all(contexts.map((c) => c.close()));
  },

  // eslint-disable-next-line no-empty-pattern
  apiAs: async ({}, use) => {
    const clients: ApiClient[] = [];
    await use(async (user) => {
      const client = await newApiClient();
      clients.push(client);
      await client.login(user.email, user.password);
      return client;
    });
    await Promise.all(clients.map((c) => c.request.dispose()));
  },

  // eslint-disable-next-line no-empty-pattern
  kbFactory: async ({}, use) => {
    let n = 0;
    await use({
      create: (api, name = 'KB', options = {}) => {
        n += 1;
        const { runId } = loadEnv();
        const finalName = options.exact
          ? name
          : `${name} ${runId}-${process.env['TEST_PARALLEL_INDEX'] ?? '0'}-${n}`;
        return api.createKb({ name: finalName, description: options.description });
      },
    });
  },
});
