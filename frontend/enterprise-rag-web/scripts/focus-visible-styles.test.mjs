// D2 guard: the global stylesheet must give every keyboard-focusable control kind a clearly visible focus ring.
// jsdom (the unit-test DOM) neither loads the global stylesheet nor implements `:focus-visible` matching or computed
// outlines, so this is a static check on src/styles.scss; the real rendering is checked in the Playwright suite.
// Runs under `npm run test:guard` (part of `npm run lint`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const stylesFile = fileURLToPath(new URL('../src/styles.scss', import.meta.url));

/** Top-level `selector { declarations }` rules (comments removed; nested blocks are not used for these rules). */
function rules(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    body: m[2],
  }));
}

/** The declarations that apply to `selector:focus-visible` (exact selector match, any grouping). */
function focusRule(all, selector) {
  return all.find((r) =>
    r.selectors.some((s) => s.replace(/^html\s+/, '') === `${selector}:focus-visible`),
  );
}

/** True when the body draws a solid outline of at least 2px in a theme colour token. */
function isVisibleRing(body) {
  const outline = /(?:^|;|\s)outline\s*:\s*([^;]+);/.exec(body)?.[1] ?? '';
  const width = Number(/(\d+(?:\.\d+)?)px/.exec(outline)?.[1] ?? 0);
  return width >= 2 && /\bsolid\b/.test(outline) && /var\(--mat-sys-[a-z-]+\)/.test(outline);
}

const REQUIRED = [
  'a', // links (nav links, "All knowledge bases", KB names in the list)
  'button', // every native button, including mat-flat/stroked/icon buttons and the language button
  '.mat-mdc-button-base', // Material buttons rendered on <a> (mat-button links)
  '.mat-mdc-icon-button', // the language and account icon buttons
  '.mat-mdc-select', // mat-select triggers (paginator page size, member role)
  '.mat-mdc-menu-item', // language/account/nav menu items
];

test('styles.scss gives each control kind a visible :focus-visible ring', () => {
  const all = rules(readFileSync(stylesFile, 'utf8'));
  for (const selector of REQUIRED) {
    const rule = focusRule(all, selector);
    assert.ok(rule, `no ${selector}:focus-visible rule in src/styles.scss`);
    assert.ok(
      isVisibleRing(rule.body),
      `${selector}:focus-visible has no >=2px solid theme-colour outline`,
    );
  }
});

test('styles.scss does not draw the ring on plain :focus (mouse focus stays unchanged)', () => {
  const all = rules(readFileSync(stylesFile, 'utf8'));
  const plainFocus = all.filter((r) =>
    r.selectors.some((s) => /:focus(?![-\w])/.test(s) && /outline\s*:/.test(r.body)),
  );
  assert.deepEqual(plainFocus, []);
});

test('parser and checks read the expected shapes', () => {
  const all = rules(
    '// c\n/* x */\nhtml a:focus-visible, .b:focus-visible { outline: 3px solid var(--mat-sys-primary); }\n.c { color: red; }',
  );
  assert.equal(all.length, 2);
  assert.ok(focusRule(all, 'a'));
  assert.ok(focusRule(all, '.b'));
  assert.equal(focusRule(all, '.c'), undefined);
  assert.ok(isVisibleRing(' outline: 3px solid var(--mat-sys-primary);'));
  assert.ok(!isVisibleRing(' outline: 1px solid var(--mat-sys-primary);'));
  assert.ok(!isVisibleRing(' outline: none;'));
  assert.ok(!isVisibleRing(' outline: 3px solid #00f;'));
});
