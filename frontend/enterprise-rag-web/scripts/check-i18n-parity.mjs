// Verifies en/de/ar translation files have identical keys, non-empty string values and identical {{param}} names.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'src/assets/i18n';
const langs = ['en', 'de', 'ar'];

const flatten = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
};
const params = (s) =>
  [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

const errors = [];
const files = {};
for (const l of langs) {
  try {
    files[l] = flatten(JSON.parse(readFileSync(join(dir, `${l}.json`), 'utf8')));
  } catch (e) {
    errors.push(`${l}: cannot read/parse (${e.message})`);
  }
}
if (errors.length === 0) {
  const all = new Set(langs.flatMap((l) => Object.keys(files[l])));
  for (const key of all) {
    for (const l of langs) {
      const v = files[l][key];
      if (v === undefined) errors.push(`${l}: missing key ${key}`);
      else if (typeof v !== 'string' || v.trim() === '') errors.push(`${l}: empty or non-string value for ${key}`);
    }
    const ps = langs.filter((l) => typeof files[l][key] === 'string').map((l) => params(files[l][key]));
    if (new Set(ps).size > 1) errors.push(`placeholder mismatch for ${key}`);
  }
}
if (errors.length) {
  console.error('i18n parity check failed:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}
console.log('i18n parity OK');
