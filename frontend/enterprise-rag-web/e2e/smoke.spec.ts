import { expect, test } from './support/fixtures';
import { collectConsoleErrors } from './support/console';
import { env } from './support/env';

test.describe('smoke', () => {
  test('App_AnonymousRoot_RedirectsToLoginWithReturnUrl_InEnglishLtr', async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto('/knowledge-bases');

    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fknowledge-bases$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page).toHaveTitle(/Sign in/);
    expect(errors.unexpected()).toEqual([]);
  });

  test('App_Root_RedirectsAnonymousToLogin', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/login\?returnUrl=/);
    await expect(page.getByLabel('Email')).toBeVisible();
  });

  test('App_LoginOnPhone_FitsTheViewport @mobile', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('Proxy_HealthReady_Returns200FromTheRealApi', async ({ request }) => {
    // Through the Angular dev-server proxy (same origin as the app), not the API port directly.
    const response = await request.get(new URL('/health/ready', env.baseUrl).toString());

    expect(response.status()).toBe(200);
  });

  test('AdminStorageState_RestoresSessionWithoutLogin', async ({ adminPage }) => {
    const errors = collectConsoleErrors(adminPage);
    const urls: string[] = [];
    adminPage.on('framenavigated', (frame) => {
      if (frame === adminPage.mainFrame()) urls.push(frame.url());
    });

    await adminPage.goto('/knowledge-bases');

    await expect(
      adminPage.getByRole('heading', { level: 1, name: 'Knowledge bases' }),
    ).toBeVisible();
    await expect(adminPage).toHaveURL(/\/knowledge-bases$/);
    expect(urls.filter((u) => u.includes('/login'))).toEqual([]);
    expect(errors.unexpected()).toEqual([]);
  });
});
