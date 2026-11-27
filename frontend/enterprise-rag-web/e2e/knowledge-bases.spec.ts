/**
 * Knowledge bases through the real UI and API: empty state, create (client validation), rename, optimistic concurrency
 * (412 "changed elsewhere" + Reload), delete with confirmation, HTML in user content rendered as text, the
 * indistinguishable Not Found for KBs the caller cannot see, and the absence of owner actions for Viewers and Editors.
 * Owner flows use the admin chain (`adminPage`; the KB is created by the admin API, so the admin is its only owner);
 * tests that need a user without KBs or a non-owner role use `newUser()` + `asUser()` (no UI sign-in in this file).
 */
import { Page, Request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { KbRole } from './support/api';
import { expect, test } from './support/fixtures';
import { gotoSignedIn, t } from './support/ui';
import { uniqueSuffix } from './support/unique';
import { uniqueEmail } from './support/users';

const kbPath = (id: string) => `/knowledge-bases/${id}`;

/** The page is still signed in (rule for `adminPage` tests: end on an authenticated assertion). */
async function expectSignedIn(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: t('en', 'user.menu') })).toBeVisible();
}

/** A snack-bar message (the visible one; Material may also mirror it into a live region). */
const snackbar = (page: Page, key: string) =>
  page.getByText(t('en', key), { exact: true }).filter({ visible: true }).first();

const kbHeading = (page: Page, name: string) =>
  page.getByRole('heading', { level: 1, name, exact: true });

test.describe('knowledge bases', () => {
  test('EmptyState_UserWithoutKnowledgeBases_SeesEmptyMessageAndNoTable', async ({
    newUser,
    asUser,
  }) => {
    const user = await newUser();
    const page = await asUser(user);

    await gotoSignedIn(page, '/knowledge-bases');

    await expect(page.getByRole('heading', { level: 1, name: t('en', 'kb.title') })).toBeVisible();
    const empty = page.getByRole('status').filter({ hasText: t('en', 'kb.list.empty') });
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(t('en', 'kb.list.emptyHint'));
    await expect(page.getByRole('table', { name: t('en', 'kb.list.tableLabel') })).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('en', 'kb.list.new') })).toBeVisible();
  });

  test('Create_WhitespaceOnlyNameIsRejected_ValidNameOpensTheDetailPage', async ({
    adminPage: page,
    adminApi,
  }) => {
    const creates: Request[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/knowledge-bases')
        creates.push(r);
    });
    await gotoSignedIn(page, '/knowledge-bases');
    await page.getByRole('button', { name: t('en', 'kb.list.new') }).click();
    const dialog = page.getByRole('dialog', { name: t('en', 'kb.create.title') });
    await expect(dialog).toBeVisible();
    const name = dialog.getByRole('textbox', { name: t('en', 'kb.create.name') });

    await name.fill('   ');
    await dialog.getByRole('button', { name: t('en', 'kb.create.submit') }).click();
    await expect(dialog.getByText(t('en', 'kb.validation.nameRequired'))).toBeVisible();
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog).toBeVisible();
    expect(creates, 'an invalid form is not sent').toHaveLength(0);

    const kbName = `Created KB ${uniqueSuffix()}`;
    await name.fill(kbName);
    const created = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/knowledge-bases',
    );
    await dialog.getByRole('button', { name: t('en', 'kb.create.submit') }).click();
    expect((await created).status()).toBe(201);

    await expect(page).toHaveURL(/\/knowledge-bases\/[0-9a-f-]{36}$/);
    await expect(kbHeading(page, kbName)).toBeVisible();
    await expect(dialog).toHaveCount(0);
    const id = new URL(page.url()).pathname.split('/').pop()!;
    const kb = await adminApi.getKb(id);
    expect(kb).toMatchObject({ name: kbName, myRole: 'Owner' });
    await expectSignedIn(page);
  });

  test('Rename_Owner_SavesShowsSnackbarAndNewName', async ({
    adminPage: page,
    adminApi,
    kbFactory,
  }) => {
    const kb = await kbFactory.create(adminApi, 'Rename KB');
    const newName = `Renamed KB ${uniqueSuffix()}`;
    await gotoSignedIn(page, kbPath(kb.id));
    await expect(kbHeading(page, kb.name)).toBeVisible();

    await page.getByRole('button', { name: t('en', 'kb.detail.edit') }).click();
    const name = page.getByRole('textbox', { name: t('en', 'kb.create.name') });
    await expect(name).toHaveValue(kb.name);
    await name.fill(newName);
    await page.getByRole('button', { name: t('en', 'kb.detail.save') }).click();

    await expect(snackbar(page, 'kb.detail.saved')).toBeVisible();
    await expect(kbHeading(page, newName)).toBeVisible();
    await expect(name).toHaveCount(0); // edit form closed
    expect((await adminApi.getKb(kb.id)).name).toBe(newName);
    await expectSignedIn(page);
  });

  test('ConcurrentEdit_SecondPageGets412ChangedElsewhereBanner_ReloadRefreshesTheForm', async ({
    adminPage: pageA,
    adminApi,
    kbFactory,
  }) => {
    const kb = await kbFactory.create(adminApi, 'Concurrent KB');
    const nameA = `Saved by A ${uniqueSuffix()}`;
    const nameB = `Stale edit by B ${uniqueSuffix()}`;

    // Two pages of the same user (same context), loaded one after the other (the refresh cookie rotates).
    await gotoSignedIn(pageA, kbPath(kb.id));
    await expect(kbHeading(pageA, kb.name)).toBeVisible();
    const pageB = await pageA.context().newPage();
    await gotoSignedIn(pageB, kbPath(kb.id));
    await expect(kbHeading(pageB, kb.name)).toBeVisible();

    for (const p of [pageA, pageB])
      await p.getByRole('button', { name: t('en', 'kb.detail.edit') }).click();

    await pageA.getByRole('textbox', { name: t('en', 'kb.create.name') }).fill(nameA);
    await pageA.getByRole('button', { name: t('en', 'kb.detail.save') }).click();
    await expect(snackbar(pageA, 'kb.detail.saved')).toBeVisible();
    await expect(kbHeading(pageA, nameA)).toBeVisible();

    const fieldB = pageB.getByRole('textbox', { name: t('en', 'kb.create.name') });
    await fieldB.fill(nameB);
    const save = pageB.waitForResponse(
      (r) =>
        r.request().method() === 'PUT' &&
        new URL(r.url()).pathname === `/api/knowledge-bases/${kb.id}`,
    );
    await pageB.getByRole('button', { name: t('en', 'kb.detail.save') }).click();
    expect((await save).status()).toBe(412);

    const banner = pageB
      .getByRole('alert')
      .filter({ hasText: t('en', 'kb.detail.changedElsewhere') });
    await expect(banner).toBeVisible();
    await expect(fieldB).toHaveValue(nameB); // the user's edit is kept until they reload

    await banner.getByRole('button', { name: t('en', 'kb.detail.reload') }).click();
    await expect(banner).toHaveCount(0);
    await expect(fieldB).toHaveValue(nameA);
    await expect(kbHeading(pageB, nameA)).toBeVisible();
    expect((await adminApi.getKb(kb.id)).name, 'the stale edit was not saved').toBe(nameA);

    await expectSignedIn(pageA);
    await expectSignedIn(pageB);
  });

  test('Delete_WithConfirmation_ReturnsToListWithSnackbar_AndTheKbIsGone', async ({
    adminPage: page,
    adminApi,
    kbFactory,
  }) => {
    const kb = await kbFactory.create(adminApi, 'Delete KB');
    await gotoSignedIn(page, kbPath(kb.id));
    await expect(kbHeading(page, kb.name)).toBeVisible();

    // Cancel keeps it.
    await page.getByRole('button', { name: t('en', 'kb.detail.delete') }).click();
    const confirm = page.getByRole('dialog', { name: t('en', 'kb.detail.deleteTitle') });
    await expect(confirm).toContainText(kb.name);
    await confirm.getByRole('button', { name: t('en', 'common.cancel') }).click();
    await expect(confirm).toHaveCount(0);
    await expect(kbHeading(page, kb.name)).toBeVisible();

    await page.getByRole('button', { name: t('en', 'kb.detail.delete') }).click();
    await confirm.getByRole('button', { name: t('en', 'common.delete') }).click();

    await expect(page).toHaveURL(/\/knowledge-bases$/);
    await expect(snackbar(page, 'kb.detail.deleted')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: t('en', 'kb.title') })).toBeVisible();
    await expect(page.getByRole('link', { name: kb.name, exact: true })).toHaveCount(0);
    await expect(adminApi.getKb(kb.id)).rejects.toThrow(/HTTP 404/);
    await expectSignedIn(page);
  });

  test('Xss_HtmlInKbNameAndDisplayName_RendersAsLiteralText_NoScriptRuns', async ({
    adminPage: page,
    adminApi,
    kbFactory,
  }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(`${d.type()}: ${d.message()}`);
      void d.dismiss();
    });
    const kb = await kbFactory.create(adminApi, '<img src=x onerror=alert(1)>', {
      description: '<script>alert(2)</script>',
    });
    const displayName = `<b>Bold</b> <img src=x onerror=alert(3)> ${uniqueSuffix()}`;
    const member = await adminApi.createUser({
      email: uniqueEmail('xss'),
      displayName,
      globalRole: 'User',
    });
    await adminApi.addMember(kb.id, member.id, 'Viewer');

    await gotoSignedIn(page, kbPath(kb.id));
    await expect(kbHeading(page, kb.name)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(kb.name);
    await expect(page.getByText('<script>alert(2)</script>', { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: t('en', 'kb.detail.tabs.members') }).click();
    const table = page.getByRole('table', { name: t('en', 'kb.members.tableLabel') });
    await expect(table.getByRole('cell', { name: displayName, exact: true })).toBeVisible();
    await expect(
      page.getByRole('combobox', {
        name: t('en', 'kb.members.changeRoleFor', { name: displayName }),
      }),
    ).toBeVisible();

    // The confirmation dialog interpolates the name into a translated message: still text.
    await page.getByRole('button', { name: t('en', 'kb.detail.delete') }).click();
    const confirm = page.getByRole('dialog', { name: t('en', 'kb.detail.deleteTitle') });
    await expect(confirm).toContainText(kb.name);
    await confirm.getByRole('button', { name: t('en', 'common.cancel') }).click();
    await expect(confirm).toHaveCount(0);

    // Nothing was turned into markup, and no script ran.
    await expect(page.locator('img')).toHaveCount(0);
    await expect(page.locator('main b, main script')).toHaveCount(0);
    expect(dialogs).toEqual([]);
    await expectSignedIn(page);
  });

  test('NonMember_DeepLinkToAnotherUsersKb_ShowsTheSameNotFoundAsAnUnknownId', async ({
    adminApi,
    kbFactory,
    newUser,
    asUser,
  }) => {
    const kb = await kbFactory.create(adminApi, 'Private KB');
    const user = await newUser();
    const page = await asUser(user);
    const notFound = page.getByRole('heading', { level: 1, name: t('en', 'notFound.heading') });
    const kbGet = (id: string) =>
      page.waitForResponse((r) => new URL(r.url()).pathname === `/api/knowledge-bases/${id}`);

    const existing = kbGet(kb.id);
    await gotoSignedIn(page, kbPath(kb.id));
    const existingStatus = (await existing).status();
    await expect(notFound).toBeVisible();
    const existingText = await page.getByRole('main').innerText();

    const unknownId = randomUUID();
    const unknown = kbGet(unknownId);
    await gotoSignedIn(page, kbPath(unknownId));
    const unknownStatus = (await unknown).status();
    await expect(notFound).toBeVisible();
    const unknownText = await page.getByRole('main').innerText();

    expect(existingText).toBe(unknownText);
    expect(existingText).toContain(t('en', 'notFound.body'));
    expect(existingText).not.toContain(kb.name);
    expect(existingStatus).toBe(unknownStatus); // the API does not reveal the KB either
    expect(existingStatus).toBe(404);
  });

  for (const role of ['Viewer', 'Editor'] as const satisfies readonly KbRole[]) {
    test(`${role}_SeesNoOwnerActions_OnDetailsOrMembers`, async ({
      adminApi,
      kbFactory,
      newUser,
      asUser,
    }) => {
      const kb = await kbFactory.create(adminApi, `${role} KB`);
      const user = await newUser();
      await adminApi.addMember(kb.id, user.id, role);
      const page = await asUser(user);

      await gotoSignedIn(page, kbPath(kb.id));
      await expect(kbHeading(page, kb.name)).toBeVisible();
      await expect(
        page.getByText(t('en', 'kb.detail.myRole', { role: t('en', `kb.role.${role}`) }), {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: t('en', 'kb.detail.edit') })).toHaveCount(0);
      await expect(page.getByRole('button', { name: t('en', 'kb.detail.delete') })).toHaveCount(0);

      await page.getByRole('tab', { name: t('en', 'kb.detail.tabs.members') }).click();
      const table = page.getByRole('table', { name: t('en', 'kb.members.tableLabel') });
      await expect(table.getByRole('cell', { name: user.displayName, exact: true })).toBeVisible();
      await expect(page.getByText(t('en', 'kb.members.ownerOnly'))).toBeVisible();
      await expect(page.getByRole('combobox')).toHaveCount(0); // no picker, no role selects
      await expect(page.getByRole('button', { name: t('en', 'kb.members.addSubmit') })).toHaveCount(
        0,
      );
      await expect(page.getByRole('button', { name: t('en', 'kb.members.remove') })).toHaveCount(0);
      await expect(
        page.getByRole('columnheader', { name: t('en', 'kb.members.columns.actions') }),
      ).toHaveCount(0);
    });
  }
});
