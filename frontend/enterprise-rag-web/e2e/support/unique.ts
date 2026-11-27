import { randomBytes } from 'node:crypto';

// Dependency-free on purpose (also loaded by scripts/e2e-unique.test.mjs through Node's type stripping).

let counter = 0;

/**
 * `<runId>-w<workerIndex>-<n>-<random>`: unique per run, per worker PROCESS and per call. TEST_WORKER_INDEX (not
 * TEST_PARALLEL_INDEX) because Playwright reuses the parallel index when it replaces a worker after a failure/retry,
 * and the new process restarts this counter; the random part guards against any remaining collision.
 */
export function uniqueSuffix(): string {
  counter += 1;
  const runId = process.env['E2E_RUN_ID'] || 'local';
  const worker = process.env['TEST_WORKER_INDEX'] ?? '0';
  return `${runId}-w${worker}-${counter}-${randomBytes(3).toString('hex')}`;
}
