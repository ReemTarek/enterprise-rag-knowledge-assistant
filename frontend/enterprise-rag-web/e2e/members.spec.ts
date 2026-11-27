/**
 * Knowledge-base membership through the real UI and API: the debounced user picker, add / change role / remove, the
 * last-owner rule, and an owner demoted elsewhere losing the owner controls after the next action. The owner is the
 * admin chain (`adminPage`; the KB is created by the admin API, so the admin is its only owner); members are created by
 * the admin API (no sign-in needed to be listed in the directory). The demoted-owner test uses its own user from
 * `newUser()`, so the admin's role is never touched by another party. No UI sign-in in this file.
 */
import { Page, Request } from '@playwright/test';
import { ApiClient, KnowledgeBase } from './support/api';
import { expect, test } from './support/fixtures';
import { gotoSignedIn, t } from './support/ui';
import { uniqueSuffix } from './support/unique';
import { uniqueEmail } from './support/users';

/** Debounce of the user picker (src/app/shared/user-picker/user-picker.ts, USER_SEARCH_DEBOUNCE_MS). */
const PICKER_DEBOUNCE_MS = 300;

async function expectSignedIn(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: t('en', 'user.menu') })).toBeVisible();
}

const snackbar = (page: Page, key: string) =>
  page.getByText(t('en', key), { exact: true }).filter({ visible: true }).first();

const isDirectory = (r: Request) => new URL(r.url()).pathname === '/api/users/directory';

/** Opens the KB detail page on the Members tab. */
async function openMembers(page: Page, kb: KnowledgeBase): Promise<void> {
  await gotoSignedIn(page, `/knowledge-bases/${kb.id}`);
  await expect(page.getByRole('heading', { level: 1, name: kb.name, exact: true })).toBeVisible();
  await page.getByRole('tab', { name: t('en', 'kb.detail.tabs.members') }).click();
  await expect(page.getByRole('table', { name: t('en', 'kb.members.tableLabel') })).toBeVisible();
}

const roleSelect = (page: Page, name: string) =>
  page.getByRole('combobox', { name: t('en', 'kb.members.changeRoleFor', { name }), exact: true });

const removeButton = (page: Page, name: string) =>
  page.getByRole('button', { name: t('en', 'kb.members.removeFor', { name }), exact: true });

const memberRow = (page: Page, name: string) =>
  page
    .getByRole('table', { name: t('en', 'kb.members.tableLabel') })
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name, exact: true }) });

/** A user for the directory: unique name and email, created by the admin (no sign-in). */
async function directoryUser(adminApi: ApiClient, label: string) {
  const token = uniqueSuffix();
  const displayName = `${label} ${token}`;
  const created = await adminApi.createUser({
    email: uniqueEmail(label.toLowerCase()),
    displayName,
    globalRole: 'User',
  });
  return { id: created.id, email: created.email, displayName, token };
}

test.describe('members', () => {
  test('Picker_OneCharacterSendsNoRequest_SecondCharacterSendsOneAfterTheDebounce', async ({
    adminPage: page,
    adminApi,
    kbFactory,
  }) => {
    const kb = await kbFactory.create(adminApi, 'Picker KB');
    await directoryUser(adminApi, 'Listed'); // at least one non-member matches "e2" (even in a fresh database)
    // Fake timers (time still flows): lets the test move past the debounce window without sleeping.
    await page.clock.install();
    const queries: string[] = [];
    page.on('request', (r) => {
      if (isDirectory(r)) queries.push(new URL(r.url()).searchParams.get('query') ?? '');
    });
    await openMembers(page, kb);
    const input = page.getByRole('combobox', { name: t('en', 'userPicker.label') });

    await input.pressSequentially('e');
    await expect(page.getByText(t('en', 'userPicker.hint'))).toBeVisible();
    // Well past the debounce: a debounced 1-character search would be sent now (and reach the counter before the
    // request awaited below, which is sent later).
    await page.clock.runFor(PICKER_DEBOUNCE_MS * 3);

    // Stop the fake clock so the debounce window is measured in fake time only (no real time slips in).
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    expect(queries, 'no query for 1 character').toEqual([]);
    const search = page.waitForRequest(isDirectory);
    await input.pressSequentially('2');
    expect(queries, 'nothing sent while typing').toEqual([]);
    await page.clock.runFor(PICKER_DEBOUNCE_MS - 50);
    expect(queries, 'nothing sent before the debounce ends').toEqual([]);
    await page.clock.runFor(100);
    const request = await search;
    await page.clock.resume();

    expect(new URL(request.url()).searchParams.get('query')).toBe('e2');
    expect(queries, 'only the 2-character query was sent, once').toEqual(['e2']);
    // Every E2E user's email contains "e2" (@e2e.test), including the one created above: results are listed.
    await expect(page.getByRole('option').first()).toBeVisible();
    expect(queries).toEqual(['e2']);
    await expectSignedIn(page);
  });

  test('AddMember_AsViewer_ThroughThePicker_ShowsTheRowAndSnackbar', async ({
    adminPage: page,
    adminApi,
    kbFactory,
  }) => {
    const kb = await kbFactory.create(adminApi, 'Add member KB');
    const user = await directoryUser(adminApi, 'Added');
    await openMembers(page, kb);

    await page.getByRole('combobox', { name: t('en', 'userPicker.label') }).fill(user.token);
    await page.getByRole('option', { name: user.displayName }).click();
    await expect(
      page.getByRole('combobox', { name: t('en', 'kb.members.roleLabel'), exact: true }),
    ).toHaveText(t('en', 'kb.role.Viewer'));
    await page.getByRole('button', { name: t('en', 'kb.members.addSubmit'), exact: true }).click();

    await expect(snackbar(page, 'kb.members.added')).toBeVisible();
    await expect(memberRow(page, user.displayName)).toBeVisible();
    await expect(roleSelect(page, user.displayName)).toHaveText(t('en', 'kb.role.Viewer'));
    expect(await adminApi.members(kb.id)).toContainEqual(
      expect.objectContaining({ userId: user.id, role: 'Viewer' }),
    );
    await expectSignedIn(page);
  });

  test('ChangeRole_ViewerToEditor_IsSaved', async ({ adminPage: page, adminApi, kbFactory }) => {
    const kb = await kbFactory.create(adminApi, 'Role KB');
    const user = await directoryUser(adminApi, 'Promoted');
    await adminApi.addMember(kb.id, user.id, 'Viewer');
    await openMembers(page, kb);

    const select = roleSelect(page, user.displayName);
    await expect(select).toHaveText(t('en', 'kb.role.Viewer'));
    const put = page.waitForResponse(
      (r) =>
        r.request().method() === 'PUT' &&
        new URL(r.url()).pathname === `/api/knowledge-bases/${kb.id}/members/${user.id}`,
    );
    await select.click();
    await page.getByRole('option', { name: t('en', 'kb.role.Editor'), exact: true }).click();
    expect((await put).status()).toBe(200);

    await expect(select).toHaveText(t('en', 'kb.role.Editor'));
    expect(await adminApi.members(kb.id)).toContainEqual(
      expect.objectContaining({ userId: user.id, role: 'Editor' }),
    );
    await expectSignedIn(page);
  });

  test('Remove_WithConfirmation_RemovesTheRow', async ({
    adminPage: page,
    adminApi,
    kbFactory,
  }) => {
    const kb = await kbFactory.create(adminApi, 'Remove KB');
    const user = await directoryUser(adminApi, 'Removed');
    await adminApi.addMember(kb.id, user.id, 'Viewer');
    await openMembers(page, kb);
    await expect(memberRow(page, user.displayName)).toBeVisible();

    await removeButton(page, user.displayName).click();
    const confirm = page.getByRole('dialog', { name: t('en', 'kb.members.removeTitle') });
    await expect(confirm).toContainText(user.displayName);
    await confirm.getByRole('button', { name: t('en', 'kb.members.remove'), exact: true }).click();

    await expect(snackbar(page, 'kb.members.removed')).toBeVisible();
    await expect(memberRow(page, user.displayName)).toHaveCount(0);
    expect((await adminApi.members(kb.id)).map((m) => m.userId)).not.toContain(user.id);
    await expectSignedIn(page);
  });

  test('LastOwner_Remove_ShowsTranslatedMessage_AndKeepsTheOwner', async ({
    adminPage: page,
    adminApi,
    kbFactory,
  }) => {
    const kb = await kbFactory.create(adminApi, 'Last owner remove KB');
    const admin = await adminApi.me();
    await openMembers(page, kb);

    await removeButton(page, admin.displayName).click();
    const confirm = page.getByRole('dialog', { name: t('en', 'kb.members.removeTitle') });
    const del = page.waitForResponse((r) => r.request().method() === 'DELETE');
    await confirm.getByRole('button', { name: t('en', 'kb.members.remove'), exact: true }).click();
    expect((await del).status()).toBe(409);

    await expect(
      page.getByRole('alert').filter({ hasText: t('en', 'kb.members.lastOwner') }),
    ).toBeVisible();
    await expect(memberRow(page, admin.displayName)).toBeVisible();
    await expect(roleSelect(page, admin.displayName)).toHaveText(t('en', 'kb.role.Owner'));
    expect(await adminApi.members(kb.id)).toEqual([
      expect.objectContaining({ userId: admin.id, role: 'Owner' }),
    ]);
    await expectSignedIn(page);
  });

  test('LastOwner_Demote_ShowsTranslatedMessage_AndTheSelectShowsOwnerAgain', async ({
    adminPage: page,
    adminApi,
    kbFactory,
  }) => {
    const kb = await kbFactory.create(adminApi, 'Last owner demote KB');
    const admin = await adminApi.me();
    await openMembers(page, kb);

    const select = roleSelect(page, admin.displayName);
    const put = page.waitForResponse((r) => r.request().method() === 'PUT');
    await select.click();
    await page.getByRole('option', { name: t('en', 'kb.role.Editor'), exact: true }).click();
    expect((await put).status()).toBe(409);

    await expect(
      page.getByRole('alert').filter({ hasText: t('en', 'kb.members.lastOwner') }),
    ).toBeVisible();
    await expect(select).toHaveText(t('en', 'kb.role.Owner'));
    expect(await adminApi.members(kb.id)).toEqual([
      expect.objectContaining({ userId: admin.id, role: 'Owner' }),
    ]);
    await expectSignedIn(page);
  });

  test('OwnerDemotedElsewhere_LosesOwnerControls_AfterTheNextAction', async ({
    adminApi,
    kbFactory,
    newUser,
    asUser,
  }) => {
    const kb = await kbFactory.create(adminApi, 'Demoted owner KB');
    const owner = await newUser();
    await adminApi.addMember(kb.id, owner.id, 'Owner');
    const other = await directoryUser(adminApi, 'Bystander');
    await adminApi.addMember(kb.id, other.id, 'Viewer');
    const page = await asUser(owner);
    await openMembers(page, kb);
    await expect(removeButton(page, other.displayName)).toBeVisible();
    await expect(page.getByRole('button', { name: t('en', 'kb.detail.edit') })).toBeVisible();

    // Another owner (the admin) demotes this user while the page is open.
    await adminApi.setMemberRole(kb.id, owner.id, 'Viewer');

    // Next action: removing a member is refused (403); the page re-reads the KB and drops the owner controls.
    await removeButton(page, other.displayName).click();
    const del = page.waitForResponse((r) => r.request().method() === 'DELETE');
    await page
      .getByRole('dialog', { name: t('en', 'kb.members.removeTitle') })
      .getByRole('button', { name: t('en', 'kb.members.remove'), exact: true })
      .click();
    expect((await del).status()).toBe(403);

    await expect(page.getByText(t('en', 'kb.members.ownerOnly'))).toBeVisible();
    await expect(
      page.getByText(t('en', 'kb.detail.myRole', { role: t('en', 'kb.role.Viewer') }), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('en', 'kb.members.remove') })).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('en', 'kb.detail.edit') })).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('en', 'kb.detail.delete') })).toHaveCount(0);
    await expect(memberRow(page, other.displayName)).toBeVisible(); // nothing was removed
    expect((await adminApi.members(kb.id)).map((m) => m.userId)).toContain(other.id);
  });
});
