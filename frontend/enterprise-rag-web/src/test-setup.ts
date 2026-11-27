import { vi } from 'vitest';
import { installFakeBroadcastChannel } from './app/core/auth/broadcast-channel.testing';

// Cross-tab sign-out uses BroadcastChannel. Node's implementation reaches other worker threads (other spec files
// running in parallel), so every spec gets an in-process fake instead. Assigned directly (not vi.stubGlobal) so a
// spec's vi.unstubAllGlobals() cannot remove it.
installFakeBroadcastChannel();

/**
 * Vitest's `vi.waitFor` defaults to a 1 s timeout. The first spec in a file pays the cold-start cost of
 * compiling/lazy-loading components, which exceeds 1 s on slower machines (observed on Linux CI runners),
 * so give every `vi.waitFor` without an explicit timeout a 10 s budget. Explicit options are kept.
 */
const originalWaitFor = vi.waitFor.bind(vi);
const DEFAULT_TIMEOUT_MS = 10_000;

vi.waitFor = ((callback: Parameters<typeof vi.waitFor>[0], options?: Parameters<typeof vi.waitFor>[1]) => {
  const merged =
    typeof options === 'number'
      ? options
      : { timeout: DEFAULT_TIMEOUT_MS, ...(options ?? {}) };
  return originalWaitFor(callback, merged);
}) as typeof vi.waitFor;
