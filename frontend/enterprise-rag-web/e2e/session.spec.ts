/**
 * Session lifetime in the browser: restore on reload, sign-out, cross-tab sign-out (D7), refresh cookie hygiene and
 * an unreachable API behind the proxy (D8). No UI sign-in here: the admin chain (`adminPage`) or a new user's
 * creation session (`newUser` + `asUser`, 2 login permits each) is used. Tests that sign out use their own user, never
 * the admin (docs/FRONTEND.md "E2E tests").
 */
import { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { env } from './support/env';
import { gotoSignedIn, reloadSignedIn, t } from './support/ui';

/** Main-frame URLs (full loads and router navigations) whose path is /login. */
function trackLoginNavigations(page: Page): string[] {
  const seen: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && new URL(frame.url()).pathname === '/login')
      seen.push(frame.url());
  });
  return seen;
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: t('en', 'user.menu') }).click();
  const logout = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/logout');
  await page.getByRole('menuitem', { name: t('en', 'user.logout') }).click();
  expect((await logout).status()).toBe(204);
}

const kbHeading = (page: Page) =>
  page.getByRole('heading', { level: 1, name: t('en', 'kb.title') });

test.describe('session', () => {
  test('Reload_RestoresSession_WithoutEverShowingLogin', async ({ adminPage: page }) => {
    await gotoSignedIn(page, '/knowledge-bases', test.info());
    await expect(kbHeading(page)).toBeVisible();
    // Also catch a login form that is rendered without a URL change (e.g. a flash before the redirect back).
    await page.addInitScript(() => {
      const w = window as unknown as { __sawPasswordInput?: boolean };
      new MutationObserver(() => {
        if (document.querySelector('input[type=password]')) w.__sawPasswordInput = true;
      }).observe(document, { childList: true, subtree: true });
    });

    let loginUrls: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && new URL(frame.url()).pathname === '/login')
        loginUrls.push(frame.url());
    });
    const retries = await reloadSignedIn(page, test.info());
    if (retries > 0) loginUrls = []; // a rate-limited attempt (429) is not what this test is about

    await expect(kbHeading(page)).toBeVisible();
    await expect(page).toHaveURL(/\/knowledge-bases$/);
    expect(loginUrls).toEqual([]);
    expect(
      await page.evaluate(
        () => (window as { __sawPasswordInput?: boolean }).__sawPasswordInput ?? false,
      ),
    ).toBe(false);
  });

  test('RefreshCookie_IsHttpOnlyStrictAndScoped_AndNoSecretsInStorageOrUrl', async ({
    adminPage: page,
  }) => {
    const refresh = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/auth/refresh' && r.status() === 200,
    );
    await gotoSignedIn(page, '/knowledge-bases', test.info());
    const accessToken = ((await (await refresh).json()) as { accessToken: string }).accessToken;
    await expect(kbHeading(page)).toBeVisible();

    const cookies = await page.context().cookies();
    const cookie = cookies.find((c) => c.name === 'refresh_token');
    expect(cookie, 'refresh cookie present').toBeDefined();
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/api/auth',
    });
    // Script cannot read it (HttpOnly) and nothing else is stored as a cookie.
    expect(await page.evaluate(() => document.cookie)).toBe('');

    const storage = await page.evaluate(() => ({
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
    }));
    const dump = JSON.stringify(storage);
    expect(Object.keys(storage.session)).toEqual([]);
    expect(
      Object.keys(storage.local).filter((k) => k !== 'lang'),
      'only the language is stored',
    ).toEqual([]);
    for (const secret of [accessToken, cookie!.value, env.adminNewPassword]) {
      expect(dump.includes(secret)).toBe(false);
      expect(page.url().includes(secret)).toBe(false);
    }
    expect(dump).not.toMatch(/eyJ[\w-]+\.[\w-]+\./); // no JWT of any kind
    expect(page.url()).not.toMatch(/token|password|eyJ/i);
  });

  test('SignOut_GoesToLogin_RemovesCookie_AndReloadStaysSignedOut', async ({ newUser, asUser }) => {
    const user = await newUser();
    const page = await asUser(user);
    await gotoSignedIn(page, '/knowledge-bases', test.info());
    await expect(kbHeading(page)).toBeVisible();

    await signOut(page);

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: t('en', 'login.heading') })).toBeVisible();
    expect(
      (await page.context().cookies()).filter((c) => c.name === 'refresh_token' && c.value),
    ).toEqual([]);

    const refresh = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/refresh');
    await page.reload();
    expect((await refresh).status(), 'no session to restore').toBe(401);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: t('en', 'login.heading') })).toBeVisible();
    await expect(page.getByRole('button', { name: t('en', 'user.menu') })).toHaveCount(0);
  });

  test('D7_SignOutInOneTab_SendsTheOtherTabToLogin_WithoutSecretsOrLoops', async ({
    newUser,
    asUser,
  }) => {
    const user = await newUser();
    const pageA = await asUser(user);
    const context = pageA.context();
    // Listen on the app's channel in every page of the context to check what crosses tabs.
    await context.addInitScript(() => {
      const w = window as unknown as { __authMessages: unknown[] };
      w.__authMessages = [];
      new BroadcastChannel('erag-auth').onmessage = (e) => w.__authMessages.push(e.data);
    });

    const refreshA = pageA.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/auth/refresh' && r.status() === 200,
    );
    await gotoSignedIn(pageA, '/knowledge-bases', test.info());
    await expect(kbHeading(pageA)).toBeVisible();
    const tokenA = ((await (await refreshA).json()) as { accessToken: string }).accessToken;

    // Tab B opens after A (one after the other: the refresh cookie rotates on each load).
    const pageB = await context.newPage();
    const refreshB = pageB.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/auth/refresh' && r.status() === 200,
    );
    await gotoSignedIn(pageB, '/knowledge-bases', test.info());
    await expect(kbHeading(pageB)).toBeVisible();
    const tokenB = ((await (await refreshB).json()) as { accessToken: string }).accessToken;
    const loginInB = trackLoginNavigations(pageB);
    const apiCallsInB: string[] = [];
    pageB.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/'))
        apiCallsInB.push(new URL(r.url()).pathname);
    });

    await signOut(pageA);
    await expect(pageA).toHaveURL(/\/login$/);

    // B still holds a valid 15-minute access token in memory; without cross-tab sign-out it would keep working.
    await expect(pageB).toHaveURL(/\/login$/);
    await expect(pageB.getByRole('heading', { name: t('en', 'login.heading') })).toBeVisible();
    await expect(pageB.getByRole('button', { name: t('en', 'user.menu') })).toHaveCount(0);
    // B's next action (opening a protected page in the app) stays signed out.
    await pageB.evaluate(() => history.pushState(null, '', '/knowledge-bases'));
    await pageB.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await expect(pageB).toHaveURL(/\/login/);
    await expect(pageB.getByRole('heading', { name: t('en', 'login.heading') })).toBeVisible();

    // The message carries no session data, and B did not bounce between pages.
    const messages = await pageB.evaluate(
      () => (window as unknown as { __authMessages: unknown[] }).__authMessages,
    );
    expect(messages).toEqual([{ type: 'logout' }]);
    const raw = JSON.stringify(messages);
    for (const secret of [tokenA, tokenB, user.email, user.id, user.password])
      expect(raw.includes(secret)).toBe(false);
    expect(loginInB.length).toBeLessThanOrEqual(2);
    expect(
      apiCallsInB.filter((p) => p !== '/api/auth/refresh'),
      'B made no authorized call after sign-out',
    ).toEqual([]);
  });

  test('D8_GatewayErrors_ShowNetworkMessage_KeepSession_AndRetryRecovers', async ({
    adminPage: page,
  }) => {
    await gotoSignedIn(page, '/knowledge-bases', test.info());
    await expect(kbHeading(page)).toBeVisible();

    // The API is down behind the proxy: every API call answers a bare 502 (no ProblemDetails), like the dev proxy.
    await page.route('**/api/**', (route) => route.fulfill({ status: 502, body: '' }));
    await page.getByRole('link', { name: t('en', 'nav.administration') }).click();

    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(
      page.getByRole('alert').filter({ hasText: t('en', 'errors.network') }),
    ).toBeVisible();
    await expect(page.getByText(t('en', 'errors.generic'))).toHaveCount(0);
    const retry = page.getByRole('button', { name: t('en', 'common.retry') });
    await expect(retry).toBeVisible();
    // Session kept: still signed in, no redirect to /login.
    await expect(page.getByRole('button', { name: t('en', 'user.menu') })).toBeVisible();
    await expect(page.getByRole('link', { name: t('en', 'nav.administration') })).toBeVisible();

    await page.unroute('**/api/**');
    await retry.click();
    await expect(
      page.getByRole('table', { name: t('en', 'admin.users.tableLabel') }),
    ).toBeVisible();
    await expect(
      page.getByRole('alert').filter({ hasText: t('en', 'errors.network') }),
    ).toHaveCount(0);
  });

  test('D8_ChangePassword_GatewayError_ShowsNetworkMessage', async ({ adminPage: page }) => {
    // KNOWN APP GAP (reported by Task 3, not fixed here: no app changes in this task): change-password.ts maps
    // every non-zero status other than 400/429 to errors.generic (`api.status !== 0`), so a proxy 502 shows
    // "Something went wrong" instead of the network message. Remove fixme once the component uses the error type.
    test.fixme(
      true,
      'change-password shows errors.generic for a gateway 502 (checks status !== 0, not the error type)',
    );
    await gotoSignedIn(page, '/settings', test.info());
    await page.getByRole('link', { name: t('en', 'settings.changePassword') }).click();
    await expect(
      page.getByRole('heading', { name: t('en', 'changePassword.heading') }),
    ).toBeVisible();

    // Only the password endpoint is "down"; nothing reaches the API, so the admin's password is untouched.
    await page.route('**/api/auth/password', (route) => route.fulfill({ status: 502, body: '' }));
    await page
      .getByLabel(t('en', 'changePassword.current'), { exact: true })
      .fill('Current-pass-1234');
    await page.getByLabel(t('en', 'changePassword.new'), { exact: true }).fill('New-password-5678');
    await page
      .getByLabel(t('en', 'changePassword.confirm'), { exact: true })
      .fill('New-password-5678');
    await page.getByRole('button', { name: t('en', 'changePassword.submit') }).click();

    await expect(
      page.getByRole('alert').filter({ hasText: t('en', 'errors.network') }),
    ).toBeVisible();
    await page.unroute('**/api/auth/password');
    await expect(page.getByRole('button', { name: t('en', 'user.menu') })).toBeVisible();
  });
});
