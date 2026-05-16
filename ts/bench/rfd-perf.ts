import hasRequiredFunctionDocs from '../src/rules/require-function-doc.js';
import { writeFileSync } from 'node:fs';

const fixtures = [
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
const W = 10000,
  N = 200000;
for (let i = 0; i < W; i++) for (const f of fixtures) hasRequiredFunctionDocs(f);
const s = performance.now();
for (let i = 0; i < N; i++) for (const f of fixtures) hasRequiredFunctionDocs(f);
const e = performance.now() - s,
  c = N * fixtures.length;
writeFileSync(
  '/tmp/bench_rfd_result.txt',
  Math.round(c / (e / 1000)).toLocaleString() +
    ' ops/s ' +
    ((e / c) * 1e6).toFixed(0) +
    'ns/call\n',
  'utf-8',
);
