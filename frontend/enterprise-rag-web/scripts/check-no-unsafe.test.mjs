// Self-check: `node --test scripts` proves the guard fails on violations and passes on clean code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./check-no-unsafe.mjs', import.meta.url));
const run = (content) => {
  const dir = mkdtempSync(join(tmpdir(), 'unsafe-'));
  writeFileSync(join(dir, 'x.ts'), content);
  return spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
};

test('clean file passes', () => assert.equal(run('const a = 1;\n').status, 0));
test('innerHTML fails', () => assert.equal(run('el.innerHTML = x;\n').status, 1));
test('bypassSecurityTrust fails', () => assert.equal(run('s.bypassSecurityTrustHtml(x);\n').status, 1));
test('eval( fails', () => assert.equal(run('eval("1");\n').status, 1));
test('localStorage + token fails (case-insensitive)', () =>
  assert.equal(run('localStorage.setItem("Token", t);\n').status, 1));
test('localStorage without token passes', () =>
  assert.equal(run('localStorage.setItem("lang", l);\n').status, 0));
