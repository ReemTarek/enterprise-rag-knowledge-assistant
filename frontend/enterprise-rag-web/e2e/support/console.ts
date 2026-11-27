import { ConsoleMessage, Page } from '@playwright/test';

/**
 * Known benign console errors. Each entry needs a justification; anything else fails the test.
 * - Chromium logs every non-2xx fetch as "Failed to load resource: ... 401 (Unauthorized)". On a first visit without
 *   a session the app's restoreSession() calls `POST /api/auth/refresh` with no cookie and the API answers 401 by
 *   design (docs/FRONTEND.md, auth flow). This is a network log entry, not a JavaScript error.
 */
const BENIGN: { pattern: RegExp; why: string }[] = [
  {
    pattern: /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/,
    why: 'anonymous session restore: POST /api/auth/refresh without cookie answers 401',
  },
];

export interface ConsoleErrors {
  /** Every console error and uncaught page error, in order. */
  all(): string[];
  /** Errors that are not on the benign list (assert this is empty). */
  unexpected(): string[];
}

/**
 * Collects `console.error` messages and uncaught exceptions (`pageerror`) of a page. A 401 network log is only
 * benign when it comes from the refresh endpoint (checked via the message location).
 */
export function collectConsoleErrors(page: Page): ConsoleErrors {
  const entries: { text: string; benign: boolean }[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = `${msg.text()} @ ${msg.location().url}`;
    const benign =
      BENIGN.some((b) => b.pattern.test(msg.text())) &&
      msg.location().url.endsWith('/api/auth/refresh');
    entries.push({ text, benign });
  });
  page.on('pageerror', (error) =>
    entries.push({ text: `pageerror: ${error.message}`, benign: false }),
  );
  return {
    all: () => entries.map((e) => e.text),
    unexpected: () => entries.filter((e) => !e.benign).map((e) => e.text),
  };
}
