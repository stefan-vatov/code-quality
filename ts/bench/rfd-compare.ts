import hasRequiredFileDoc from '../src/rules/require-file-doc.js';
import hasRequiredFunctionDocs from '../src/rules/require-function-doc.js';
import { writeFileSync } from 'node:fs';

let out = '=== require-function-doc (10 fixtures) ===\n';

// ---- bench 1: 10 normal fixtures ----
const ffixtures = [
  '/** login. */\nexport async function login(u, p) { return true; }',
  '/** URL. */\nexport const API_URL = "https://x.com";',
  'export function parse(q) { return {}; }',
  "export { foo } from './foo';",
  '/** First. */\nexport function a() {}\n\nconst x = 1;\nexport function b() {}',
  '#!/usr/bin/env node\n/** CLI. */\nexport function main() {}',
  'function helper(x) { return x * 2; }',
  '/** Handler. */\nexport abstract class Handler {}',
  '/** Boot. */\nexport default async function boot() {}',
  '/** Config. */\nexport interface CacheConfig { ttl: number; }',
];
const W = 10000, N = 200000;
for (let i = 0; i < W; i++) for (const f of ffixtures) hasRequiredFunctionDocs(f);
let s = performance.now();
for (let i = 0; i < N; i++) for (const f of ffixtures) hasRequiredFunctionDocs(f);
let e = performance.now() - s, c = N * ffixtures.length;
out += Math.round(c / (e / 1000)).toLocaleString() + ' ops/s ' + (e / c * 1e6).toFixed(0) + 'ns/call\n';

// ---- bench 2: worst-case — long file with many exports, no JSDoc (scans whole file) ----
const bigExport = 'export function fn' + '_'.repeat(30) + '() { return 42; }\n';
const bigFileNoDocs = bigExport.repeat(20);
for (let i = 0; i < W; i++) hasRequiredFunctionDocs(bigFileNoDocs);
s = performance.now();
for (let i = 0; i < N / 10; i++) hasRequiredFunctionDocs(bigFileNoDocs);
e = performance.now() - s, c = (N / 10);
out += 'worst-case (20 exports, no docs): ' + Math.round(c / (e / 1000)).toLocaleString() + ' ops/s ' + (e / c * 1e6).toFixed(0) + 'ns/call\n';

// ---- bench 3: best-case — no exports at all ----
const noExports = 'function helper() { return 1; }\nconst x = 42;\n' + 'class Foo {}\n'.repeat(10);
for (let i = 0; i < W; i++) hasRequiredFunctionDocs(noExports);
s = performance.now();
for (let i = 0; i < N; i++) hasRequiredFunctionDocs(noExports);
e = performance.now() - s, c = N;
out += 'best-case (no exports): ' + Math.round(c / (e / 1000)).toLocaleString() + ' ops/s ' + (e / c * 1e6).toFixed(0) + 'ns/call\n';

// ---- bench 4: comparison — hasRequiredFileDoc (simpler rule) ----
const fdoc = [
  '/** docs */\nimport { x } from "y";',
  '// @internal\nimport { x } from "y";',
  'import { x } from "y";',
  '#!/usr/bin/env node\n/** CLI. */\ncode();',
  '',
];
for (let i = 0; i < W; i++) for (const f of fdoc) hasRequiredFileDoc(f);
s = performance.now();
for (let i = 0; i < N; i++) for (const f of fdoc) hasRequiredFileDoc(f);
e = performance.now() - s, c = N * fdoc.length;
out += '\n=== hasRequiredFileDoc (5 fixtures) ===\n';
out += Math.round(c / (e / 1000)).toLocaleString() + ' ops/s ' + (e / c * 1e6).toFixed(0) + 'ns/call\n';

writeFileSync('/tmp/bench_compare.txt', out, 'utf-8');
