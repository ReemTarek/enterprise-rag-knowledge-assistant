import { defineConfig } from 'vitest/config';

// Loaded by the Angular unit-test builder (angular.json `runnerConfig`). Specs that drive the real router
// lazy-load and compile feature chunks on first use, which takes several seconds on loaded CI runners;
// a generous per-test budget avoids timing flakes without hiding real hangs.
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
