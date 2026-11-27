/**
 * Sign-in and the forced password change, driven through the real UI against the real API.
 *
 * LOGIN BUDGET (docs/FRONTEND.md "E2E tests"). The API limits login + password change per client IP, and every client
 * of the suite shares one IP. Run-wide, a full run spends about 30 login-bucket permits: global setup 1, `adminApi` 1
 * per worker (2 desktop + 1 mobile), the `adminPage` sign-in of every worker that does not take over the global-setup
 * state (desktop 1 + mobile 1), `newUser()` 2 each (session 2, knowledge-bases 4, members 1, admin-users 2 = 18), the
 * 2 API sign-ins of the admin-users reset test, the 1 UI submit of admin-users.spec and the 3 UI submits of THIS file
 * (a worker replaced after a failure signs in again). That exceeds the production 10/min, so the E2E stack starts the
 * API with `RateLimit__LoginPermitsPerMinute=1000` / `RateLimit__RefreshPermitsPerMinute=3000` (scripts/e2e-stack.mjs;
 * production keeps 10 and 30) and nothing here waits out a 429.
 *
 * Apart from one first sign-in with a temporary password in admin-users.spec.ts, this is the only spec file that signs
 * in through the UI, serially in ONE browser context shared by its tests:
 *   1. wrong password (401)             -> 1 login
 *   2. temporary password (forced flow) -> 1 login
 *   3. valid password change            -> 1 password change (login bucket)
 * = 3 UI submits per run (limit for this file: 8), each logged as `[e2e-budget] ui-login`. The test user is created
 * by the admin API and keeps its temporary password (no login of its own).
 */
import { BrowserContext, Page, Request } from '@playwright/test';
import { expectNoSeriousViolations } from './support/axe';
import { expect, test } from './support/fixtures';
import { UserCredentials, createPendingUser, strongPassword } from './support/users';
import {
  Lang,
  gotoSignedIn,
  intersects,
  reloadSignedIn,
  submitAuthForm,
  switchLanguage,
  t,
  waitForAnimations,
} from './support/ui';

test.describe.configure({ mode: 'serial' });

test.describe('auth (UI sign-in, forced password change)', () => {
  let context: BrowserContext;
  let page: Page;
  let user: UserCredentials;
  const requests: Request[] = [];

  const field = (label: string) => page.getByLabel(label, { exact: true });

  test.beforeAll(async ({ browser, adminApi }, testInfo) => {
    user = await createPendingUser(adminApi);
    const use = testInfo.project.use;
    context = await browser.newContext({
      baseURL: use.baseURL,
      locale: use.locale,
      viewport: use.viewport,
    });
    page = await context.newPage();
    page.on('request', (r) => requests.push(r));
  });

  test.afterAll(async () => {
    await context?.close();
  });

  const authCalls = (path: string) =>
    requests.filter((r) => r.method() === 'POST' && new URL(r.url()).pathname === path).length;

  test('Login_WrongPassword_ShowsGenericMessage_ClearsPasswordKeepsEmail', async () => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: t('en', 'login.heading') })).toBeVisible();

    const res = await submitAuthForm(page, {
      path: '/api/auth/login',
      fill: async () => {
        await field(t('en', 'login.email')).fill(user.email);
        await field(t('en', 'login.password')).fill('Wrong-password-123');
      },
      submit: page.getByRole('button', { name: t('en', 'login.submit') }),
    });

    expect(res.status()).toBe(401);
    await expect(
      page.getByRole('alert').filter({ hasText: t('en', 'login.error.invalid') }),
    ).toBeVisible();
    await expect(field(t('en', 'login.password'))).toHaveValue('');
    await expect(field(t('en', 'login.email'))).toHaveValue(user.email);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('Login_TemporaryPassword_ForcesChangePassword_WithBannerAndNoNavigation', async () => {
    const res = await submitAuthForm(page, {
      path: '/api/auth/login',
      fill: async () => {
        await field(t('en', 'login.email')).fill(user.email);
        await field(t('en', 'login.password')).fill(user.password);
      },
      submit: page.getByRole('button', { name: t('en', 'login.submit') }),
    });

    expect(res.status()).toBe(200);
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(
      page.getByRole('heading', { name: t('en', 'changePassword.heading') }),
    ).toBeVisible();
    await expect(page.getByText(t('en', 'changePassword.banner'))).toBeVisible();
    // Nothing to navigate to while the change is due: no nav landmark, no app links; only language and account.
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByRole('link', { name: t('en', 'nav.knowledgeBases') })).toHaveCount(0);
    await expect(page.getByRole('link', { name: t('en', 'nav.administration') })).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('en', 'language.switch') })).toBeVisible();
    await expect(page.getByRole('button', { name: t('en', 'user.menu') })).toBeVisible();
  });

  test('Axe_ForcedChangePassword_NoSeriousOrCriticalViolations_EnglishAndArabic', async () => {
    // The forced state (banner, no navigation) only exists for a user who must change the password: scanned here.
    await expect(page.getByText(t('en', 'changePassword.banner'))).toBeVisible();
    await expectNoSeriousViolations(page, 'forced change password (en)');

    await switchLanguage(page, 'en', 'ar');
    await expect(page.getByText(t('ar', 'changePassword.banner'))).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expectNoSeriousViolations(page, 'forced change password (ar)');
    await switchLanguage(page, 'ar', 'en');
  });

  test('D1_ChangePassword_HintDoesNotOverlapConfirmField_InEnglishGermanArabic', async () => {
    let current: Lang = 'en';
    for (const lang of ['en', 'de', 'ar'] as const) {
      if (lang !== current) await switchLanguage(page, current, lang);
      current = lang;
      await expect(
        page.getByRole('heading', { name: t(lang, 'changePassword.heading') }),
      ).toBeVisible();
      await waitForAnimations(page);

      const hint = page.getByText(t(lang, 'changePassword.hint'), { exact: true });
      // The visible box of the confirm field (outline + label), not its subscript area.
      const confirmBox = page
        .locator('mat-form-field')
        .filter({ has: field(t(lang, 'changePassword.confirm')) })
        .locator('.mat-mdc-text-field-wrapper');
      const hintRect = await hint.boundingBox();
      const confirmRect = await confirmBox.boundingBox();
      expect(hintRect, `${lang}: hint rendered`).not.toBeNull();
      expect(confirmRect, `${lang}: confirm field rendered`).not.toBeNull();
      expect(
        intersects(hintRect!, confirmRect!),
        `${lang}: hint ${JSON.stringify(hintRect)} overlaps confirm field ${JSON.stringify(confirmRect)}`,
      ).toBe(false);
      expect(
        hintRect!.y + hintRect!.height,
        `${lang}: hint ends above the confirm field`,
      ).toBeLessThanOrEqual(confirmRect!.y);
    }
    await switchLanguage(page, current, 'en');
  });

  test('ForcedChange_DirectUrls_AllEndAtChangePassword', async () => {
    for (const path of ['/knowledge-bases', '/admin/users', '/settings']) {
      await gotoSignedIn(page, path);
      await expect(page, `${path} is blocked`).toHaveURL(
        `/change-password?returnUrl=${encodeURIComponent(path)}`,
      );
      await expect(
        page.getByRole('heading', { name: t('en', 'changePassword.heading') }),
      ).toBeVisible();
      await expect(page.getByRole('navigation')).toHaveCount(0);
    }
  });

  test('ChangePassword_WeakOrMismatchedPassword_ShowsClientErrors_WithoutCallingTheApi', async () => {
    const before = authCalls('/api/auth/password');
    const submit = page.getByRole('button', { name: t('en', 'changePassword.submit') });

    await field(t('en', 'changePassword.current')).fill(user.password);
    await field(t('en', 'changePassword.new')).fill('short');
    await field(t('en', 'changePassword.confirm')).fill('different');
    await submit.click();

    for (const key of ['minLength', 'upper', 'digit', 'mismatch']) {
      await expect(page.getByText(t('en', `changePassword.validation.${key}`))).toBeVisible();
    }

    await field(t('en', 'changePassword.new')).fill(user.password);
    await field(t('en', 'changePassword.confirm')).fill(user.password);
    await submit.click();
    await expect(page.getByText(t('en', 'changePassword.validation.sameAsCurrent'))).toBeVisible();

    expect(authCalls('/api/auth/password'), 'invalid forms are not sent').toBe(before);
    await expect(page).toHaveURL(/\/change-password/);
  });

  test('ChangePassword_Valid_GoesHome_InTheSameSession_AndSurvivesReload', async () => {
    await gotoSignedIn(page, '/change-password');
    await expect(page.getByText(t('en', 'changePassword.banner'))).toBeVisible();
    const loginsBefore = authCalls('/api/auth/login');
    const loginUrls: string[] = [];
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame() && new URL(f.url()).pathname === '/login') loginUrls.push(f.url());
    });
    const newPassword = strongPassword();

    const res = await submitAuthForm(page, {
      path: '/api/auth/password',
      fill: async () => {
        await field(t('en', 'changePassword.current')).fill(user.password);
        await field(t('en', 'changePassword.new')).fill(newPassword);
        await field(t('en', 'changePassword.confirm')).fill(newPassword);
      },
      submit: page.getByRole('button', { name: t('en', 'changePassword.submit') }),
    });

    expect(res.status()).toBe(204);
    await expect(page).toHaveURL(/\/knowledge-bases$/);
    await expect(page.getByRole('heading', { level: 1, name: t('en', 'kb.title') })).toBeVisible();
    await expect(page.getByRole('navigation', { name: t('en', 'nav.main') })).toBeVisible();

    // The refresh cookie of this session still works: a reload restores it without the login page.
    await reloadSignedIn(page);
    await expect(page.getByRole('heading', { level: 1, name: t('en', 'kb.title') })).toBeVisible();
    await expect(page).toHaveURL(/\/knowledge-bases$/);
    expect(authCalls('/api/auth/login'), 'no new sign-in').toBe(loginsBefore);
    expect(loginUrls).toEqual([]);
  });
});
