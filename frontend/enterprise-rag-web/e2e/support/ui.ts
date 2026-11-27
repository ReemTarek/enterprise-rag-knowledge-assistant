import { Locator, Page, Response, expect, test } from '@playwright/test';
import ar from '../../src/assets/i18n/ar.json';
import de from '../../src/assets/i18n/de.json';
import en from '../../src/assets/i18n/en.json';

/**
 * Shared UI helpers for the specs: translated strings straight from the app's i18n files (so a test asserts what the
 * user sees in each language without hard-coding copies), language switching through the real switcher, UI sign-in
 * and signed-in page loads that check the session restore.
 */

export type Lang = 'en' | 'de' | 'ar';

const dictionaries: Record<Lang, unknown> = { en, de, ar };

/** Translation of `key` (dotted path) in `lang`, with `{{param}}` interpolation like Transloco. */
export function t(lang: Lang, key: string, params: Record<string, string> = {}): string {
  let node: unknown = dictionaries[lang];
  for (const part of key.split('.')) {
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined;
  }
  if (typeof node !== 'string') throw new Error(`Missing translation ${lang}:${key}`);
  return node.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => params[name] ?? `{{${name}}}`);
}

/** Switches the language through the toolbar/login language menu (no reload, no API call). */
export async function switchLanguage(page: Page, from: Lang, to: Lang): Promise<void> {
  await page.getByRole('button', { name: t(from, 'language.switch') }).click();
  await page.getByRole('menuitemradio', { name: t(from, `language.name.${to}`) }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', to);
  await expect(page.getByRole('menu')).toHaveCount(0);
}

/**
 * `adminPage` hands its storage state (including localStorage) to the next test of the worker: a test that switched
 * the language must leave English behind so the next test starts in the default language.
 */
export async function leaveEnglishForNextTest(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.setItem('lang', 'en'));
}

const isPost = (r: Response, path: string) =>
  r.request().method() === 'POST' && new URL(r.url()).pathname === path;

/**
 * Fills and submits an auth form (sign-in or change password) through the UI and returns the API response. Each submit
 * is logged as `[e2e-budget] ui-login` and annotated on the test (counted in the run report). No 429 handling: the
 * E2E API runs with raised rate limits (scripts/e2e-stack.mjs), so a 429 here is a real failure.
 */
export async function submitAuthForm(
  page: Page,
  options: {
    path: '/api/auth/login' | '/api/auth/password';
    fill: () => Promise<void>;
    submit: Locator;
  },
): Promise<Response> {
  await options.fill();
  const response = page.waitForResponse((r) => isPost(r, options.path));
  await options.submit.click();
  const res = await response;
  test
    .info()
    .annotations.push({ type: 'ui-login', description: `${options.path} -> ${res.status()}` });
  console.log(`[e2e-budget] ui-login ${options.path} -> ${res.status()}`);
  return res;
}

/**
 * Loads (or reloads) a signed-in page and checks that the session restore (`POST /api/auth/refresh`) succeeded, so a
 * test fails with a clear message instead of finding itself on the login page.
 */
export async function gotoSignedIn(
  page: Page,
  url: string,
  load: (p: Page) => Promise<unknown> = (p) => p.goto(url),
): Promise<void> {
  const refresh = page.waitForResponse((r) => isPost(r, '/api/auth/refresh'));
  await load(page);
  expect((await refresh).status(), `session restore for ${url}`).toBe(200);
}

/** Same as `gotoSignedIn` for a reload of the current page. */
export function reloadSignedIn(page: Page): Promise<void> {
  return gotoSignedIn(page, page.url(), (p) => p.reload());
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Waits until no finite CSS animation/transition runs (dialog/menu open, ripples), so measurements and axe see the end
 * state. Infinite animations (spinners, indeterminate progress bars) are ignored: they never finish.
 */
export async function waitForAnimations(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (a) =>
                a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity,
            ).length,
      ),
    )
    .toBe(0);
}
