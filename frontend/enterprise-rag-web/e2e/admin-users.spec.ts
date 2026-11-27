/**
 * Admin user management through the real UI and API: create user and the one-time temporary-password dialog (cannot
 * be dismissed by Escape, backdrop or Back; LTR field; Copy; acknowledgement; no trace after close), first sign-in with
 * the temporary password, deactivate (the user's open page is sent to /login), reset password, no Deactivate on the
 * admin's own row, and the admin guard for non-admins. The admin works through the admin chain (`adminPage`) and only
 * ever deactivates or resets users created by the test itself (never the E2E admin, whose sessions the chain relies on).
 *
 * LOGIN BUDGET: one UI sign-in per run (`NewUser_SignsInWithTheTemporaryPassword_...`: 1 login submit, logged as
 * `[e2e-budget] ui-login`); `newUser()` costs 2 API permits (2 tests here); the reset test signs in twice through the
 * API to prove which password works. All well inside the E2E stack's raised limit (docs/FRONTEND.md "E2E tests").
 */
import { Locator, Page } from '@playwright/test';
import { env } from './support/env';
import { expect, test } from './support/fixtures';
import { gotoSignedIn, submitAuthForm, t, waitForAnimations } from './support/ui';
import { uniqueSuffix } from './support/unique';
import { newApiClient, uniqueEmail } from './support/users';

async function expectSignedIn(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: t('en', 'user.menu') })).toBeVisible();
}

const usersTable = (page: Page) =>
  page.getByRole('table', { name: t('en', 'admin.users.tableLabel') });

const tempDialog = (page: Page) =>
  page.getByRole('dialog', { name: t('en', 'admin.tempPassword.title') });

const passwordField = (dialog: Locator) =>
  dialog.getByRole('textbox', { name: t('en', 'admin.tempPassword.label') });

/** Opens Administration > Users by in-app navigation from the KB list (so Back has an in-app entry to go to). */
async function openUsers(page: Page): Promise<void> {
  await gotoSignedIn(page, '/knowledge-bases');
  await page.getByRole('link', { name: t('en', 'nav.administration') }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(usersTable(page)).toBeVisible();
}

/**
 * The users table row of `email`. The list is paged (ordered by email) and other workers add users meanwhile; users are
 * never deleted, so a row can only move to a later page: scanning forward from the current page always finds it.
 */
async function findUserRow(page: Page, email: string): Promise<Locator> {
  const next = page.getByRole('button', { name: t('en', 'kb.paginator.next') });
  for (let pageNo = 0; pageNo < 200; pageNo++) {
    await expect(usersTable(page)).toBeVisible();
    const row = usersTable(page).getByRole('row').filter({ hasText: email });
    if ((await row.count()) > 0) return row;
    if (await next.isDisabled()) break;
    const loaded = page.waitForResponse(
      (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/admin/users',
    );
    await next.click();
    await loaded;
  }
  throw new Error(`No row for ${email} in the users table.`);
}

/** Creates a user through the New user dialog; returns the open temporary-password dialog and the API's password. */
async function createUserInUi(page: Page, email: string, displayName: string) {
  await page.getByRole('button', { name: t('en', 'admin.users.new') }).click();
  const create = page.getByRole('dialog', { name: t('en', 'admin.users.create.title') });
  await create.getByRole('textbox', { name: t('en', 'admin.users.create.email') }).fill(email);
  await create
    .getByRole('textbox', { name: t('en', 'admin.users.create.displayName') })
    .fill(displayName);
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/admin/users',
  );
  await create.getByRole('button', { name: t('en', 'admin.users.create.submit') }).click();
  const res = await created;
  expect(res.status()).toBe(201);
  const { temporaryPassword } = (await res.json()) as { temporaryPassword: string };

  const dialog = tempDialog(page);
  await expect(dialog).toBeVisible();
  await expect(create).toHaveCount(0);
  await expect(passwordField(dialog)).toHaveValue(temporaryPassword);
  return { dialog, password: temporaryPassword };
}

async function acknowledgeAndClose(dialog: Locator): Promise<void> {
  await dialog.getByRole('checkbox', { name: t('en', 'admin.tempPassword.acknowledge') }).check();
  await dialog.getByRole('button', { name: t('en', 'common.close') }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe('admin users', () => {
  test('TempPasswordDialog_EscapeBackdropAndBrowserBack_DoNotDismissIt', async ({
    adminPage: page,
  }) => {
    await openUsers(page);
    const { dialog, password } = await createUserInUi(
      page,
      uniqueEmail('ui-dismiss'),
      `Dismiss ${uniqueSuffix()}`,
    );

    await page.keyboard.press('Escape');
    await waitForAnimations(page); // a closing dialog would animate out and be removed
    await expect(dialog, 'Escape').toBeVisible();

    await page.mouse.click(5, 5); // the backdrop covers the viewport corner
    await waitForAnimations(page);
    await expect(dialog, 'backdrop click').toBeVisible();

    await page.goBack();
    await waitForAnimations(page);
    await expect(dialog, 'browser Back').toBeVisible();
    await expect(passwordField(dialog)).toHaveValue(password);

    await acknowledgeAndClose(dialog);
    await expectSignedIn(page);
  });

  test('TempPasswordDialog_PasswordFieldIsLtr_AndCopyPutsThePasswordOnTheClipboard', async ({
    adminPage: page,
  }) => {
    await openUsers(page);
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: new URL(page.url()).origin,
      });
    const { dialog, password } = await createUserInUi(
      page,
      uniqueEmail('ui-copy'),
      `Copy ${uniqueSuffix()}`,
    );
    const field = passwordField(dialog);
    await expect(field).toHaveAttribute('dir', 'ltr');
    await expect(field).toHaveCSS('direction', 'ltr');
    await expect(field).toHaveAttribute('readonly', '');

    await dialog.getByRole('button', { name: t('en', 'common.copy') }).click();
    const status = dialog.getByRole('status');
    await expect(status).not.toBeEmpty();
    const copied = (await status.innerText()).trim() === t('en', 'admin.tempPassword.copied');
    if (!copied) {
      await acknowledgeAndClose(dialog);
      test.skip(true, 'The browser denied clipboard access although the permissions were granted.');
    }
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(password);

    await acknowledgeAndClose(dialog);
    await expectSignedIn(page);
  });

  test('TempPasswordDialog_AcknowledgementEnablesClose_AndThePasswordLeavesNoTrace', async ({
    adminPage: page,
  }) => {
    await openUsers(page);
    const { dialog, password } = await createUserInUi(
      page,
      uniqueEmail('ui-ack'),
      `Acknowledge ${uniqueSuffix()}`,
    );
    const close = dialog.getByRole('button', { name: t('en', 'common.close') });
    const ack = dialog.getByRole('checkbox', { name: t('en', 'admin.tempPassword.acknowledge') });

    await expect(close).toBeDisabled();
    await ack.check();
    await expect(close).toBeEnabled();
    await ack.uncheck();
    await expect(close).toBeDisabled();
    await ack.check();
    await close.click();
    await expect(dialog).toHaveCount(0);
    await expect(usersTable(page)).toBeVisible();

    const traces = await page.evaluate(() => ({
      html: document.documentElement.outerHTML,
      text: document.body.innerText,
      values: Array.from(document.querySelectorAll('input, textarea')).map(
        (e) => (e as HTMLInputElement).value,
      ),
      local: JSON.stringify(Object.entries(localStorage)),
      session: JSON.stringify(Object.entries(sessionStorage)),
      url: location.href,
    }));
    for (const [where, value] of Object.entries(traces)) {
      expect(JSON.stringify(value).includes(password), `password in ${where}`).toBe(false);
    }
    expect(page.url().includes(password)).toBe(false);
    await expectSignedIn(page);
  });

  test('NewUser_SignsInWithTheTemporaryPassword_InASecondContext_IsForcedToChangeIt', async ({
    adminPage,
    page,
  }) => {
    await openUsers(adminPage);
    const email = uniqueEmail('ui-first');
    const { dialog, password } = await createUserInUi(adminPage, email, `First ${uniqueSuffix()}`);
    await acknowledgeAndClose(dialog);
    await expectSignedIn(adminPage);

    // `page`: a fresh, anonymous context (the new user's browser).
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: t('en', 'login.heading') })).toBeVisible();
    const res = await submitAuthForm(page, {
      path: '/api/auth/login',
      fill: async () => {
        await page.getByLabel(t('en', 'login.email'), { exact: true }).fill(email);
        await page.getByLabel(t('en', 'login.password'), { exact: true }).fill(password);
      },
      submit: page.getByRole('button', { name: t('en', 'login.submit') }),
    });
    expect(res.status()).toBe(200);
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByText(t('en', 'changePassword.banner'))).toBeVisible();
    await expect(page.getByRole('link', { name: t('en', 'nav.knowledgeBases') })).toHaveCount(0);
  });

  test('Deactivate_OtherUser_TheirOpenPageGoesToLoginOnItsNextAction', async ({
    adminPage,
    newUser,
    asUser,
  }) => {
    const user = await newUser();
    const userPage = await asUser(user);
    await gotoSignedIn(userPage, '/settings');
    await expect(
      userPage.getByRole('heading', { level: 1, name: t('en', 'settings.heading') }),
    ).toBeVisible();

    await openUsers(adminPage);
    const row = await findUserRow(adminPage, user.email);
    await row.getByRole('button', { name: t('en', 'admin.users.deactivate') }).click();
    const confirm = adminPage.getByRole('dialog', { name: t('en', 'admin.users.deactivateTitle') });
    await expect(confirm).toContainText(user.displayName);
    const deactivated = adminPage.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/admin/users/${user.id}/deactivate`,
    );
    await confirm.getByRole('button', { name: t('en', 'admin.users.deactivate') }).click();
    expect((await deactivated).status()).toBe(204);

    const updated = await findUserRow(adminPage, user.email);
    await expect(updated).toContainText(t('en', 'admin.users.inactive'));
    await expect(
      updated.getByRole('button', { name: t('en', 'admin.users.deactivate') }),
    ).toHaveCount(0);
    await expectSignedIn(adminPage);

    // The deactivated user's page still shows the app; its next action (an API call) ends the session.
    await userPage.getByRole('link', { name: t('en', 'nav.knowledgeBases') }).click();
    await expect(userPage).toHaveURL(/\/login(\?|$)/);
    await expect(userPage.getByRole('heading', { name: t('en', 'login.heading') })).toBeVisible();
    await expect(userPage.getByRole('button', { name: t('en', 'user.menu') })).toHaveCount(0);
  });

  test('ResetPassword_OtherUser_ShowsANewTemporaryPasswordDialog', async ({
    adminPage: page,
    adminApi,
  }) => {
    const email = uniqueEmail('reset');
    const displayName = `Reset ${uniqueSuffix()}`;
    const created = await adminApi.createUser({ email, displayName, globalRole: 'User' });

    await openUsers(page);
    const row = await findUserRow(page, email);
    await row.getByRole('button', { name: t('en', 'admin.users.resetPassword') }).click();
    const confirm = page.getByRole('dialog', { name: t('en', 'admin.users.resetTitle') });
    await expect(confirm).toContainText(displayName);
    const reset = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/admin/users/${created.id}/reset-password`,
    );
    await confirm.getByRole('button', { name: t('en', 'admin.users.resetPassword') }).click();
    const res = await reset;
    expect(res.status()).toBe(200);
    const { temporaryPassword } = (await res.json()) as { temporaryPassword: string };

    const dialog = tempDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(email);
    await expect(passwordField(dialog)).toHaveValue(temporaryPassword);
    expect(temporaryPassword).not.toBe(created.temporaryPassword);
    await acknowledgeAndClose(dialog);
    await expect(
      (await findUserRow(page, email)).getByText(t('en', 'admin.users.mustChange')),
    ).toBeVisible();

    // The new temporary password is the one that works now (and still demands a change).
    const client = await newApiClient();
    try {
      expect((await client.tryLogin(email, created.temporaryPassword)).status).toBe(401);
      const withNew = await client.tryLogin(email, temporaryPassword);
      expect(withNew.session?.mustChangePassword).toBe(true);
    } finally {
      await client.request.dispose();
    }
    await expectSignedIn(page);
  });

  test('OwnRow_HasNoDeactivateAction', async ({ adminPage: page }) => {
    await openUsers(page);
    const row = await findUserRow(page, env.adminEmail);
    await expect(row.getByRole('cell', { name: env.adminEmail, exact: true })).toBeVisible();
    await expect(
      row.getByRole('button', { name: t('en', 'admin.users.resetPassword') }),
    ).toBeVisible();
    await expect(row.getByRole('button', { name: t('en', 'admin.users.deactivate') })).toHaveCount(
      0,
    );
    await expectSignedIn(page);
  });

  test('NonAdmin_AdminUsersUrl_GoesToForbidden', async ({ newUser, asUser }) => {
    const user = await newUser();
    const page = await asUser(user);

    await gotoSignedIn(page, '/admin/users');

    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(
      page.getByRole('heading', { level: 1, name: t('en', 'forbidden.heading') }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: t('en', 'nav.administration') })).toHaveCount(0);
    await expect(usersTable(page)).toHaveCount(0);
  });
});
