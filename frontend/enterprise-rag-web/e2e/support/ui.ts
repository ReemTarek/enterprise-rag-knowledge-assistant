import { Locator, Page, Response, TestInfo, expect } from '@playwright/test';
import ar from '../../src/assets/i18n/ar.json';
import de from '../../src/assets/i18n/de.json';
import en from '../../src/assets/i18n/en.json';

/**
 * Shared UI helpers for the specs: translated strings straight from the app's i18n files (so a test asserts what the
 * user sees in each language without hard-coding copies), language switching through the real switcher, and
 * rate-limit aware navigation/sign-in (see docs/FRONTEND.md "E2E tests": the API limits login + password change to
 * 10/min/IP and refresh + logout to 30/min/IP, shared by every worker).
 */

export type Lang = 'en' | 'de' | 'ar';
export const LANGS: readonly Lang[] = ['en', 'de', 'ar'];

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

/**
 * Refresh budget: every full page load restores the session with `POST /api/auth/refresh`, which shares 30
 * permits/min/IP with the whole suite (and with back-to-back runs). Pure client-side tests of the ANONYMOUS login page
 * (language, direction, axe, keyboard) answer that one call locally with the same 401 the API gives a browser without a
 * cookie, so they do not spend permits; nothing else is stubbed. Do not use where the session itself is under test.
 */
export async function answerAnonymousRestoreLocally(page: Page): Promise<void> {
  await page.route('**/api/auth/refresh', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/problem+json',
      body: JSON.stringify({ title: 'Unauthorized', status: 401 }),
    }),
  );
}

const isPost = (r: Response, path: string) =>
  r.request().method() === 'POST' && new URL(r.url()).pathname === path;

/** Rate-limit backoff (not a UI wait): sleeps out the API's Retry-After, like e2e/support/api.ts does. */
async function waitOutRateLimit(res: Response, testInfo: TestInfo, what: string): Promise<void> {
  const retryAfter = Math.min(Number(res.headers()['retry-after'] ?? '5') || 5, 65);
  testInfo.annotations.push({ type: 'rate-limit-wait', description: `${what}: ${retryAfter}s` });
  console.log(`[e2e-budget] 429 on ${what}, waiting ${retryAfter}s`);
  await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
}

const MAX_429_RETRIES = 3;

/**
 * Fills and submits an auth form (sign-in or change password) through the UI and returns the API response. These
 * endpoints share the login bucket (10/min/IP) with every other client of the suite, so a 429 is waited out and the
 * form (which the app clears on failure) is filled and submitted again; any other status is returned to the test.
 * Each attempt is logged as `[e2e-budget] ui-login` (counted in the run report).
 */
export async function submitAuthForm(
  page: Page,
  testInfo: TestInfo,
  options: {
    path: '/api/auth/login' | '/api/auth/password';
    fill: () => Promise<void>;
    submit: Locator;
  },
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await options.fill();
    const response = page.waitForResponse((r) => isPost(r, options.path));
    await options.submit.click();
    const res = await response;
    testInfo.annotations.push({
      type: 'ui-login',
      description: `${options.path} -> ${res.status()}`,
    });
    console.log(`[e2e-budget] ui-login ${options.path} -> ${res.status()}`);
    if (res.status() !== 429 || attempt >= MAX_429_RETRIES) return res;
    await waitOutRateLimit(res, testInfo, options.path);
  }
}

/**
 * Loads a signed-in page. Every full load restores the session with `POST /api/auth/refresh` (30/min/IP, shared by
 * the suite); a 429 there would show the login page although the cookie is fine, so it is waited out and the load
 * repeated (the cookie is not rotated by a rejected request). Returns the number of such retries.
 */
export async function gotoSignedIn(
  page: Page,
  url: string,
  testInfo: TestInfo,
  load: (p: Page) => Promise<unknown> = (p) => p.goto(url),
): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    const refresh = page.waitForResponse((r) => isPost(r, '/api/auth/refresh'));
    await load(page);
    const res = await refresh;
    if (res.status() !== 429 || attempt >= MAX_429_RETRIES) return attempt;
    await waitOutRateLimit(res, testInfo, '/api/auth/refresh');
  }
}

/** Same as `gotoSignedIn` for a reload of the current page. */
export function reloadSignedIn(page: Page, testInfo: TestInfo): Promise<number> {
  return gotoSignedIn(page, page.url(), testInfo, (p) => p.reload());
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Waits until no CSS animation/transition runs (dialog/menu open, ripples), so measurements and axe see the end state. */
export async function waitForAnimations(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length),
    )
    .toBe(0);
}
