import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const configPath = join(fixtureDirectory, 'oxlint.config.mjs');
const invalidPath = join(fixtureDirectory, 'invalid.ts');
const safePath = join(fixtureDirectory, 'safe.ts');
const expectedRuleIDs = [
  'thethracian/effect-no-global-fetch',
  'thethracian/effect-no-sync-for-promise',
  'thethracian/effect-prefer-map-over-flatMap-succeed',
  'thethracian/no-commented-out-code',
];

const runOxlint = (fixturePath, extraArguments = []) =>
  spawnSync(
    'pnpm',
    [
      'dlx',
      'oxlint@1.63.0',
      '-c',
      configPath,
      '--disable-nested-config',
      '--no-ignore',
      '--format',
      'json',
      ...extraArguments,
      fixturePath,
    ],
    {
      cwd: fixtureDirectory,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );

const invalidResult = runOxlint(invalidPath);
assert.equal(invalidResult.status, 1, invalidResult.stderr);
const { diagnostics } = JSON.parse(invalidResult.stdout);
assert.equal(diagnostics.length, expectedRuleIDs.length);
const ruleIDs = diagnostics.map(({ code }) => {
  const ruleId = code.replace(/^([^()]+)\((.+)\)$/u, '$1/$2');
  return ruleId;
});
assert.deepStrictEqual(ruleIDs.toSorted(), expectedRuleIDs.toSorted());

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'oxlint-min-peer-'));
const temporarySafePath = join(temporaryDirectory, basename(safePath));

try {
  copyFileSync(safePath, temporarySafePath);
  const beforeFix = readFileSync(temporarySafePath, 'utf8');
  const safeResult = runOxlint(temporarySafePath, ['--fix']);
  const afterFix = readFileSync(temporarySafePath, 'utf8');

  assert.equal(safeResult.status, 0, safeResult.stderr);
  assert.equal(JSON.parse(safeResult.stdout).diagnostics.length, 0);
  assert.equal(afterFix, beforeFix);
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true });
}
