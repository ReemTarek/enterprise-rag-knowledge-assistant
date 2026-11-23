// Self-check: the parity script fails on mismatched fixtures and passes on matching ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./check-i18n-parity.mjs', import.meta.url));
const run = (en, de, ar) => {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-'));
  writeFileSync(join(dir, 'en.json'), JSON.stringify(en));
  writeFileSync(join(dir, 'de.json'), JSON.stringify(de));
  writeFileSync(join(dir, 'ar.json'), JSON.stringify(ar));
  return spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
};
const ok = { a: { b: 'x {{id}}' } };

test('matching files pass', () => assert.equal(run(ok, ok, ok).status, 0));
test('missing key fails', () => assert.equal(run(ok, ok, { a: {} }).status, 1));
test('empty value fails', () => assert.equal(run(ok, ok, { a: { b: ' ' } }).status, 1));
test('placeholder mismatch fails', () => assert.equal(run(ok, { a: { b: 'x {{name}}' } }, ok).status, 1));
