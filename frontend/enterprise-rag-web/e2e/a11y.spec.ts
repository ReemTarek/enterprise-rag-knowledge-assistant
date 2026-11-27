/**
 * Accessibility: axe-core scans (WCAG 2.0/2.1 A + AA rule tags `wcag2a`, `wcag2aa`) of every Phase 2b screen in English
 * and Arabic, and the keyboard focus indicator (D2) while tabbing through the login page and the signed-in shell.
 * Serious/critical violations fail; moderate/minor ones are attached as test annotations (`axe-moderate`, ...) and
 * logged as `[axe] ...`. Signed-in screens use the admin chain (`adminPage`), navigating inside the app so one page
 * load covers all screens of a language; test data comes from the admin API (no login permit).
 */
import AxeBuilder from '@axe-core/playwright';
import { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { uniqueEmail } from './support/users';
import { expectNoSeriousViolations } from './support/axe';
import { Lang, gotoSignedIn, leaveEnglishForNextTest, switchLanguage, t } from './support/ui';

/** Describes the focused element and whether it shows a visible focus indicator (ring, shadow or thick field outline). */
function focusedIndicator(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    const name =
      el.getAttribute('aria-label') ||
      el.textContent?.trim().slice(0, 40) ||
      (el as HTMLInputElement).name ||
      el.getAttribute('type') ||
      '';
    const describe = `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} "${name}"`;
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
    const shadow =
      style.boxShadow !== 'none' &&
      !/^rgba\(\d+, \d+, \d+, 0\)/.test(style.boxShadow) &&
      style.boxShadow !== '';
    // Text inputs inside an outlined Material field: the field draws a thicker outline while focused.
    const field = el.closest('mat-form-field');
    let fieldOutline = false;
    if (field && ['INPUT', 'TEXTAREA'].includes(el.tagName)) {
      const leading = field.querySelector('.mdc-notched-outline__leading');
      fieldOutline =
        field.classList.contains('mat-focused') &&
        !!leading &&
        parseFloat(getComputedStyle(leading).borderTopWidth) >= 2;
    }
    return {
      describe,
      visible: outline || shadow || fieldOutline,
      outline: `${style.outlineStyle} ${style.outlineWidth}`,
      boxShadow: style.boxShadow,
      inPaginator: !!el.closest('mat-paginator'),
      isPaginatorSelect: !!el.closest('mat-paginator') && el.getAttribute('role') === 'combobox',
    };
  });
}

test.describe('accessibility', () => {
  for (const lang of ['en', 'ar'] as const) {
    test(`Axe_Login_NoSeriousOrCriticalViolations_${lang}`, async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByRole('heading', { name: t('en', 'login.heading') })).toBeVisible();
      if (lang !== 'en') await switchLanguage(page, 'en', lang);
      await expect(page.getByRole('heading', { name: t(lang, 'login.heading') })).toBeVisible();

      await expectNoSeriousViolations(page, `login (${lang})`);
    });

    test(`Axe_SignedInScreens_NoSeriousOrCriticalViolations_${lang}`, async ({
      adminPage: page,
      adminApi,
      kbFactory,
    }) => {
      const kb = await kbFactory.create(adminApi, 'A11y KB', { description: 'Accessibility scan' });
      const member = await adminApi.createUser({
        email: uniqueEmail('a11y'),
        displayName: 'A11y Member',
        globalRole: 'User',
      });
      await adminApi.addMember(kb.id, member.id, 'Editor');
      const l = (key: string, params?: Record<string, string>) => t(lang as Lang, key, params);

      await gotoSignedIn(page, `/knowledge-bases/${kb.id}`);
      await expect(page.getByRole('heading', { level: 1, name: kb.name })).toBeVisible();
      if (lang !== 'en') await switchLanguage(page, 'en', lang);

      await test.step('KB detail', async () => {
        await expect(page.getByRole('tab', { name: l('kb.detail.tabs.details') })).toBeVisible();
        await expectNoSeriousViolations(page, `KB detail (${lang})`);
      });
      await test.step('KB members', async () => {
        await page.getByRole('tab', { name: l('kb.detail.tabs.members') }).click();
        await expect(page.getByRole('table', { name: l('kb.members.tableLabel') })).toBeVisible();
        await expect(
          page.getByRole('combobox', {
            name: l('kb.members.changeRoleFor', { name: 'A11y Member' }),
          }),
        ).toBeVisible();
        await expectNoSeriousViolations(page, `KB detail + members (${lang})`);
      });
      await test.step('KB list', async () => {
        await page.getByRole('link', { name: l('kb.detail.back') }).click();
        await expect(page.getByRole('heading', { level: 1, name: l('kb.title') })).toBeVisible();
        await expect(page.getByRole('table', { name: l('kb.list.tableLabel') })).toBeVisible();
        await expectNoSeriousViolations(page, `KB list (${lang})`);
      });
      await test.step('admin users', async () => {
        await page.getByRole('link', { name: l('nav.administration') }).click();
        await expect(page.getByRole('table', { name: l('admin.users.tableLabel') })).toBeVisible();
        await expectNoSeriousViolations(page, `admin users (${lang})`);
      });
      await test.step('create user + temporary password dialogs', async () => {
        await page.getByRole('button', { name: l('admin.users.new') }).click();
        const create = page.getByRole('dialog', { name: l('admin.users.create.title') });
        await expect(create).toBeVisible();
        await expectNoSeriousViolations(page, `create user dialog (${lang})`);
        await create
          .getByLabel(l('admin.users.create.email'), { exact: true })
          .fill(uniqueEmail('a11y-ui'));
        await create
          .getByLabel(l('admin.users.create.displayName'), { exact: true })
          .fill('A11y Created');
        await create.getByRole('button', { name: l('admin.users.create.submit') }).click();

        const temp = page.getByRole('dialog', { name: l('admin.tempPassword.title') });
        await expect(temp).toBeVisible();
        await expect(temp.getByLabel(l('admin.tempPassword.label'))).not.toHaveValue('');
        await expectNoSeriousViolations(page, `temporary password dialog (${lang})`);
        await temp.getByRole('checkbox', { name: l('admin.tempPassword.acknowledge') }).check();
        await temp.getByRole('button', { name: l('common.close') }).click();
        await expect(temp).toHaveCount(0);
      });
      await test.step('settings', async () => {
        await page.getByRole('button', { name: l('user.menu') }).click();
        await page.getByRole('menuitem', { name: l('user.settings') }).click();
        await expect(
          page.getByRole('heading', { level: 1, name: l('settings.heading') }),
        ).toBeVisible();
        await expectNoSeriousViolations(page, `settings (${lang})`);
      });
      await test.step('change password', async () => {
        await page.getByRole('link', { name: l('settings.changePassword') }).click();
        await expect(
          page.getByRole('heading', { level: 1, name: l('changePassword.heading') }),
        ).toBeVisible();
        await expectNoSeriousViolations(page, `change password (${lang})`);
      });

      await page.getByRole('link', { name: l('nav.knowledgeBases') }).click();
      await expect(page.getByRole('heading', { level: 1, name: l('kb.title') })).toBeVisible();
      await leaveEnglishForNextTest(page);
    });
  }

  test('A11y1_Shell_AllContentInsideLandmarks', async ({ adminPage: page }) => {
    await gotoSignedIn(page, '/knowledge-bases');
    await expect(page.getByRole('heading', { level: 1, name: t('en', 'kb.title') })).toBeVisible();

    // The brand and toolbar sit in the banner landmark, the links in the labelled navigation, the page in main.
    const banner = page.getByRole('banner');
    await expect(banner.getByText(t('en', 'app.name'))).toBeVisible();
    await expect(
      banner.getByRole('navigation', { name: t('en', 'nav.main') }).getByRole('link', {
        name: t('en', 'nav.knowledgeBases'),
      }),
    ).toBeVisible();
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
    // axe best-practice landmark rules (not part of the wcag2a/aa tags above), checked explicitly here.
    const results = await new AxeBuilder({ page })
      .withRules(['region', 'landmark-one-main', 'landmark-no-duplicate-banner', 'landmark-unique'])
      .analyze();
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
      ),
    ).toEqual([]);
  });

  test('D2_Login_TabOrder_EveryFocusedControlShowsAFocusIndicator', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: t('en', 'login.heading') })).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      const focus = await focusedIndicator(page);
      expect(focus, `Tab #${i + 1} focuses a control`).not.toBeNull();
      seen.push(focus!.describe);
      expect
        .soft(
          focus!.visible,
          `${focus!.describe}: outline ${focus!.outline}, box-shadow ${focus!.boxShadow}`,
        )
        .toBe(true);
    }
    // Logical order: language, email, password, submit.
    expect(seen[0]).toContain(t('en', 'language.switch'));
    expect(seen[1]).toMatch(/^input/);
    expect(seen[2]).toMatch(/^input/);
    expect(seen[3]).toContain(t('en', 'login.submit'));
  });

  test('D2_Shell_TabOrder_EveryFocusedControlShowsAFocusIndicator', async ({
    adminPage: page,
    adminApi,
    kbFactory,
  }) => {
    await kbFactory.create(adminApi, 'Focus KB'); // at least one row link
    await gotoSignedIn(page, '/knowledge-bases');
    await expect(page.getByRole('table', { name: t('en', 'kb.list.tableLabel') })).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    const seen: string[] = [];
    let reachedPaginatorSelect = false;
    for (let i = 0; i < 40 && !reachedPaginatorSelect; i++) {
      await page.keyboard.press('Tab');
      const focus = await focusedIndicator(page);
      if (!focus) break;
      seen.push(focus.describe);
      reachedPaginatorSelect = focus.isPaginatorSelect;
      expect
        .soft(
          focus.visible,
          `${focus.describe}: outline ${focus.outline}, box-shadow ${focus.boxShadow}`,
        )
        .toBe(true);
    }
    console.log(`[focus] shell tab order: ${seen.join(' | ')}`);
    // The walk covered the toolbar (nav, language, account), the page action, table links and the paginator.
    for (const name of [
      t('en', 'nav.knowledgeBases'),
      t('en', 'nav.administration'),
      t('en', 'language.switch'),
      t('en', 'user.menu'),
      t('en', 'kb.list.new'),
    ]) {
      expect(
        seen.some((s) => s.includes(name)),
        `focus reached "${name}"`,
      ).toBe(true);
    }
    expect(reachedPaginatorSelect, 'focus reached the paginator page-size select').toBe(true);
  });
});
