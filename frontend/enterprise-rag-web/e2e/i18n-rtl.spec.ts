/**
 * Languages and right-to-left layout: Arabic switch and persistence, German labels not clipped, bidi isolation of
 * user-supplied Latin text in Arabic tables/headings (D4), left-to-right email inputs in Arabic (D5) and the compact
 * (phone) navigation menu in English and Arabic (`@mobile`, project chromium-mobile). No UI sign-in; test data via the
 * admin API (users created there keep their temporary password: no login permit). Tests on `adminPage` that switch
 * the language leave English behind for the next test of the chain.
 */
import { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { uniqueEmail } from './support/users';
import {
  answerAnonymousRestoreLocally,
  gotoSignedIn,
  leaveEnglishForNextTest,
  switchLanguage,
  t,
} from './support/ui';

/**
 * True when the user text gets its own direction from its content: the element holding it, or an ancestor up to its
 * cell/heading, is a `bdi`, has a `dir` attribute, or uses `unicode-bidi: plaintext`. (Table cells and headings are
 * already `unicode-bidi: isolate` in the UA stylesheet, but they inherit the RTL base direction, which is what moves a
 * trailing ">" of a Latin name to the wrong end; so plain `isolate` is not enough.)
 */
function isBidiIsolated(text: Locator): Promise<boolean> {
  return text.evaluate((el) => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      if (
        node.tagName === 'BDI' ||
        node.hasAttribute('dir') ||
        getComputedStyle(node).unicodeBidi === 'plaintext'
      )
        return true;
      if (['TD', 'TH', 'H1', 'H2', 'LI', 'MAIN', 'BODY'].includes(node.tagName)) return false;
    }
    return false;
  });
}

const direction = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).direction);

/**
 * Visible text controls (toolbar/nav links and buttons, page buttons) whose content is wider than their box (clipped
 * or overflowing label). Icon-only buttons are skipped: they carry no text, and Material's 48px touch target
 * deliberately overhangs their 40px box.
 */
function clippedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selector = 'header a, header button, main button, main a.mat-mdc-button-base';
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((el) => !el.classList.contains('mat-mdc-icon-button') && !!el.textContent?.trim())
      .filter((el) => el.offsetParent !== null && el.clientWidth > 0)
      .filter((el) => el.scrollWidth > el.clientWidth)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()} "${el.textContent?.trim()}" ${el.scrollWidth}>${el.clientWidth}`,
      );
  });
}

test.describe('i18n and RTL', () => {
  test('Arabic_SetsLangAndRtl_AndPersistsAcrossReload', async ({ page }) => {
    await answerAnonymousRestoreLocally(page);
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    await switchLanguage(page, 'en', 'ar');

    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: t('ar', 'login.heading') })).toBeVisible();
    await expect(page).toHaveTitle(new RegExp(t('ar', 'title.login')));

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: t('ar', 'login.heading') })).toBeVisible();
    await expect(page.getByLabel(t('ar', 'login.email'), { exact: true })).toBeVisible();
  });

  test('German_LongLabels_AreNotClipped_InToolbarNavAndButtons', async ({ adminPage: page }) => {
    await gotoSignedIn(page, '/admin/users', test.info());
    await expect(
      page.getByRole('heading', { level: 1, name: t('en', 'admin.users.title') }),
    ).toBeVisible();
    await switchLanguage(page, 'en', 'de');

    await expect(
      page.getByRole('heading', { level: 1, name: t('de', 'admin.users.title') }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: t('de', 'admin.users.resetPassword') }).first(),
    ).toBeVisible();
    expect(await clippedControls(page), 'admin users (de)').toEqual([]);

    await page.getByRole('link', { name: t('de', 'nav.knowledgeBases') }).click();
    await expect(page.getByRole('heading', { level: 1, name: t('de', 'kb.title') })).toBeVisible();
    await expect(page.getByRole('button', { name: t('de', 'kb.list.new') })).toBeVisible();
    expect(await clippedControls(page), 'knowledge bases (de)').toEqual([]);

    await leaveEnglishForNextTest(page);
  });

  test('D4_Arabic_LatinNamesAndEmails_AreBidiIsolated', async ({
    adminPage: page,
    adminApi,
    kbFactory,
  }) => {
    // Latin text ending in brackets/punctuation is what reorders in an RTL paragraph without isolation.
    const displayName = 'Bob <b>Bold</b> (QA) >';
    const member = await adminApi.createUser({
      email: uniqueEmail('bidi'),
      displayName,
      globalRole: 'User',
    });
    const kb = await kbFactory.create(adminApi, 'Bidi KB <i>x</i> >');
    await adminApi.addMember(kb.id, member.id, 'Viewer');

    await gotoSignedIn(page, `/knowledge-bases/${kb.id}`, test.info());
    await expect(page.getByRole('heading', { level: 1, name: kb.name })).toBeVisible();
    await switchLanguage(page, 'en', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    expect(
      await isBidiIsolated(
        page.getByRole('heading', { level: 1 }).getByText(kb.name, { exact: true }),
      ),
      'KB name heading',
    ).toBe(true);

    await page.getByRole('tab', { name: t('ar', 'kb.detail.tabs.members') }).click();
    const table = page.getByRole('table', { name: t('ar', 'kb.members.tableLabel') });
    const row = table.getByRole('row').filter({ hasText: member.email });
    await expect(row).toHaveCount(1);
    const name = row.getByText(displayName, { exact: true });
    const email = row.getByText(member.email, { exact: true });
    await expect(name).toBeVisible();
    expect(await isBidiIsolated(name), 'member name cell').toBe(true);
    expect(await isBidiIsolated(email), 'member email cell').toBe(true);
    expect(await direction(email), 'email runs left to right').toBe('ltr');

    await leaveEnglishForNextTest(page);
  });

  test('D5_Arabic_LoginEmailInput_RunsLeftToRight', async ({ page }) => {
    await answerAnonymousRestoreLocally(page);
    await page.goto('/login');
    await switchLanguage(page, 'en', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    const email = page.getByLabel(t('ar', 'login.email'), { exact: true });
    await email.fill('user.name@example.test');
    expect(await direction(email)).toBe('ltr');
    // The password field and the rest of the form stay RTL.
    expect(await direction(page.getByLabel(t('ar', 'login.password'), { exact: true }))).toBe(
      'rtl',
    );
  });

  test('D5_Arabic_CreateUserEmailInput_RunsLeftToRight', async ({ adminPage: page }) => {
    await gotoSignedIn(page, '/admin/users', test.info());
    await switchLanguage(page, 'en', 'ar');
    await page.getByRole('button', { name: t('ar', 'admin.users.new') }).click();
    const dialog = page.getByRole('dialog', { name: t('ar', 'admin.users.create.title') });
    await expect(dialog).toBeVisible();

    expect(
      await direction(dialog.getByLabel(t('ar', 'admin.users.create.email'), { exact: true })),
    ).toBe('ltr');

    await dialog.getByRole('button', { name: t('ar', 'common.cancel') }).click();
    await expect(dialog).toHaveCount(0);
    await leaveEnglishForNextTest(page);
  });

  for (const lang of ['en', 'ar'] as const) {
    test(`CompactMenu_OpensInsideViewport_AndNavigates_${lang} @mobile`, async ({
      adminPage: page,
    }) => {
      await gotoSignedIn(page, '/knowledge-bases', test.info());
      await expect(
        page.getByRole('heading', { level: 1, name: t('en', 'kb.title') }),
      ).toBeVisible();
      if (lang !== 'en') await switchLanguage(page, 'en', lang);

      // Phone width: the nav links collapse into one menu button.
      const nav = page.getByRole('navigation', { name: t(lang, 'nav.main') });
      await expect(nav.getByRole('link')).toHaveCount(0);
      await nav.getByRole('button', { name: t(lang, 'nav.openMenu') }).click();
      const menu = page.getByRole('menu');
      const admin = menu.getByRole('menuitem', { name: t(lang, 'nav.administration') });
      await expect(
        menu.getByRole('menuitem', { name: t(lang, 'nav.knowledgeBases') }),
      ).toBeVisible();
      await expect(admin).toBeVisible();
      const box = await menu.boundingBox();
      const viewport = page.viewportSize()!;
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);

      await admin.click();
      await expect(page).toHaveURL(/\/admin\/users$/);
      await expect(
        page.getByRole('heading', { level: 1, name: t(lang, 'admin.users.title') }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0);

      await nav.getByRole('button', { name: t(lang, 'nav.openMenu') }).click();
      await page.getByRole('menuitem', { name: t(lang, 'nav.knowledgeBases') }).click();
      await expect(page).toHaveURL(/\/knowledge-bases$/);
      await expect(
        page.getByRole('heading', { level: 1, name: t(lang, 'kb.title') }),
      ).toBeVisible();
      await leaveEnglishForNextTest(page);
    });
  }
});
