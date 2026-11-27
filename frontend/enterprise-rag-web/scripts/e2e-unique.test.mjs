// Unit check for e2e/support/unique.ts: generated test-data names must not collide when Playwright replaces a worker
// (same TEST_PARALLEL_INDEX, fresh process => fresh module counter). Loaded via Node's built-in type stripping.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const modulePath = new URL('../e2e/support/unique.ts', import.meta.url).href;

/** A fresh module instance (as in a new worker process): the counter starts again at 0. */
async function freshWorker(workerIndex) {
  process.env.TEST_PARALLEL_INDEX = '0';
  process.env.TEST_WORKER_INDEX = String(workerIndex);
  return import(`${modulePath}?worker=${workerIndex}&n=${Math.random()}`);
}

test('UniqueSuffix_ReplacedWorkerWithSameParallelIndex_DoesNotRepeatNames', async () => {
  process.env.E2E_RUN_ID = 'run1';
  const first = await freshWorker(0);
  const before = [first.uniqueSuffix(), first.uniqueSuffix()];
  const replacement = await freshWorker(1); // Playwright: new worker index, same parallel index, counter reset
  const after = [replacement.uniqueSuffix(), replacement.uniqueSuffix()];
  assert.equal(new Set([...before, ...after]).size, 4);
  assert.match(after[0], /^run1-w1-1-[0-9a-f]{6}$/);
});

test('UniqueSuffix_SameWorkerIndexAndCounter_StillDiffersByRandomPart', async () => {
  process.env.E2E_RUN_ID = 'run1';
  const a = (await freshWorker(3)).uniqueSuffix();
  const b = (await freshWorker(3)).uniqueSuffix();
  assert.notEqual(a, b);
});
