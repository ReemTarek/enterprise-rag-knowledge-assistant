// Drift check: the client's PROBLEM_TYPES must equal the server's ProblemTypes.cs URIs (read from the repository, not a
// hand-copied list). Runs under `npm run test:guard` (part of `npm run lint`). Skips, with a message, when the backend
// source is not next to the client (e.g. the frontend folder copied alone), so the check stays hermetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const serverFile = fileURLToPath(
  new URL('../../../src/EnterpriseRag.API/Http/ProblemTypes.cs', import.meta.url),
);
const clientFile = fileURLToPath(new URL('../src/app/core/api/problem-details.ts', import.meta.url));

/** `public const string Name = Base + "suffix";` -> base + suffix. */
function serverUris(source) {
  const base = /const string Base = "([^"]+)";/.exec(source)?.[1];
  assert.ok(base, 'ProblemTypes.Base not found');
  const uris = [...source.matchAll(/const string \w+ = Base \+ "([^"]+)";/g)].map((m) => base + m[1]);
  assert.ok(uris.length > 0, 'no ProblemTypes constants found');
  return uris;
}

/** The string values inside `export const PROBLEM_TYPES = { ... } as const;`. */
function clientUris(source) {
  const block = /export const PROBLEM_TYPES = \{([\s\S]*?)\} as const;/.exec(source)?.[1];
  assert.ok(block, 'PROBLEM_TYPES not found');
  return [...block.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
}

test('PROBLEM_TYPES matches src/EnterpriseRag.API/Http/ProblemTypes.cs', (t) => {
  if (!existsSync(serverFile)) {
    t.skip(`server file not found (${serverFile}); drift check skipped`);
    return;
  }
  const server = serverUris(readFileSync(serverFile, 'utf8')).sort();
  const client = clientUris(readFileSync(clientFile, 'utf8')).sort();
  assert.deepEqual(client, server);
});

test('parsers read the expected shapes', () => {
  const cs = 'public const string Base = "https://x/p/";\npublic const string A = Base + "a";';
  assert.deepEqual(serverUris(cs), ['https://x/p/a']);
  const ts = "export const PROBLEM_TYPES = {\n  a: 'https://x/p/a',\n} as const;";
  assert.deepEqual(clientUris(ts), ['https://x/p/a']);
});
