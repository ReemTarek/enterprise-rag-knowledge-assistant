import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';
import { waitForAnimations } from './ui';

/**
 * axe-core scan with the WCAG 2.0/2.1 A + AA rule tags (`wcag2a`, `wcag2aa`). Serious/critical violations fail (soft,
 * so every screen of a test is scanned); others are annotated as `axe-<impact>` and logged as `[axe] ...`.
 */
export async function expectNoSeriousViolations(page: Page, screen: string): Promise<void> {
  await waitForAnimations(page);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  for (const v of results.violations) {
    const line = `${screen}: ${v.id} (${v.impact}, ${v.nodes.length} node(s)) ${v.help}`;
    console.log(`[axe] ${line}`);
    if (!blocking.includes(v))
      test.info().annotations.push({ type: `axe-${v.impact ?? 'unknown'}`, description: line });
  }
  console.log(
    `[axe] ${screen}: ${results.violations.length} violation(s), ${results.passes.length} rule(s) passed`,
  );
  expect
    .soft(
      blocking.map(
        (v) =>
          `${v.id} (${v.impact}): ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
      ),
      `${screen}: serious/critical axe violations`,
    )
    .toEqual([]);
}
