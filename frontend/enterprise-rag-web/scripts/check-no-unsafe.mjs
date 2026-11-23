// Fails (exit 1) if source files contain patterns banned by the security policy.
// Usage: node scripts/check-no-unsafe.mjs [dir=src]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = process.argv[2] ?? 'src';
const exts = new Set(['.ts', '.html', '.scss', '.js', '.mjs']);

const rules = [
  { name: 'innerHTML', test: (l) => /innerHTML/i.test(l) },
  { name: 'bypassSecurityTrust', test: (l) => /bypassSecurityTrust/i.test(l) },
  { name: 'eval(', test: (l) => /\beval\s*\(/.test(l) },
  {
    name: 'web storage with token/password',
    test: (l) => /(localStorage|sessionStorage)/i.test(l) && /(token|password)/i.test(l),
  },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (exts.has(extname(p))) yield p;
  }
}

let violations = 0;
for (const file of walk(root)) {
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      for (const r of rules) {
        if (r.test(line)) {
          console.error(`${file}:${i + 1}: forbidden ${r.name}`);
          violations++;
        }
      }
    });
}

if (violations > 0) {
  console.error(`check-no-unsafe: ${violations} violation(s)`);
  process.exit(1);
}
console.log('check-no-unsafe: OK');
