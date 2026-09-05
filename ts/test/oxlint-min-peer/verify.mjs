import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';

const parsePackage = Schema.decodeUnknownSync(
  Schema.parseJson(Schema.Struct({ peerDependencies: Schema.Struct({ oxlint: Schema.String }) })),
);
const parseDiagnostics = Schema.decodeUnknownSync(
  Schema.parseJson(
    Schema.Struct({ diagnostics: Schema.Array(Schema.Struct({ code: Schema.String })) }),
  ),
);
const parseConfig = Schema.decodeUnknownSync(
  Schema.parseJson(
    Schema.Struct({ rules: Schema.Record({ key: Schema.String, value: Schema.Unknown }) }),
  ),
);

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const configPath = join(fixtureDirectory, 'oxlint.config.mjs');
const fullConfigPath = join(fixtureDirectory, 'full.config.mjs');
const invalidPath = join(fixtureDirectory, 'invalid.ts');
const safePath = join(fixtureDirectory, 'safe.ts');
const packagePath = join(fixtureDirectory, '..', '..', 'package.json');
const packageJSON = parsePackage(readFileSync(packagePath, 'utf8'));
const minimumPeerRange = packageJSON.peerDependencies.oxlint;
const minimumPeerVersion = /\d+\.\d+\.\d+/u.exec(minimumPeerRange)?.[0];

assert.ok(minimumPeerVersion, `Unable to parse the minimum Oxlint peer from ${minimumPeerRange}`);

const oxlintSpecifier = `oxlint@${minimumPeerVersion}`;
const expectedRuleIDs = [
  'thethracian/effect-no-floating-effect',
  'thethracian/effect-require-yield-star',
  'thethracian/effect-no-global-fetch',
];

/** @param {string} fixturePath @param {readonly string[]} extraArguments */
const runOxlint = (fixturePath, extraArguments = []) =>
  spawnSync(
    'pnpm',
    [
      'dlx',
      oxlintSpecifier,
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

const runPrintConfig = () =>
  spawnSync('pnpm', ['dlx', oxlintSpecifier, '--print-config', '-c', fullConfigPath, safePath], {
    cwd: fixtureDirectory,
    encoding: 'utf8',
    stdio: 'pipe',
  });

const invalidResult = runOxlint(invalidPath);
assert.equal(invalidResult.status, 1, invalidResult.stderr);
const { diagnostics } = parseDiagnostics(invalidResult.stdout);
assert.equal(diagnostics.length, expectedRuleIDs.length);
const ruleIDs = diagnostics.map(({ code }) => {
  const ruleId = code.replace(/^([^()]+)\((.+)\)$/u, '$1/$2');
  return ruleId;
});
assert.deepStrictEqual(ruleIDs.toSorted(), expectedRuleIDs.toSorted());

const { default: fullConfig } = await import('./full.config.mjs');
const sourceRuleNames = Object.keys(fullConfig.rules ?? {}).toSorted();
assert.equal(sourceRuleNames.length, 194, 'full minimum-peer config must expose 194 rules');
const sourceNativeRuleNames = sourceRuleNames.filter(
  (ruleName) => !ruleName.startsWith('thethracian/'),
);
const sourcePackageRuleNames = sourceRuleNames.filter((ruleName) =>
  ruleName.startsWith('thethracian/'),
);
const sourceEffectRuleNames = sourcePackageRuleNames.filter((ruleName) =>
  ruleName.startsWith('thethracian/effect-'),
);
assert.equal(sourceNativeRuleNames.length, 160, 'full config must expose 160 native rules');
assert.equal(sourcePackageRuleNames.length, 34, 'full config must expose 34 package rules');
assert.equal(
  sourceEffectRuleNames.length,
  18,
  'full config must expose all 18 Effect safety rules',
);
assert.ok(
  sourceRuleNames.includes('thethracian/no-service-constructor-imports'),
  'full config must expose the service-constructor import rule',
);
for (const ruleName of [
  'import/no-duplicates',
  'no-implied-eval',
  'oxc/only-used-in-recursion',
  'thethracian/effect-no-floating-effect',
  'typescript/no-floating-promises',
]) {
  assert.ok(sourceRuleNames.includes(ruleName), `full config is missing ${ruleName}`);
}

const printResult = runPrintConfig();
assert.equal(printResult.status, 0, printResult.stderr);
const printedNativeRuleNames = Object.keys(parseConfig(printResult.stdout).rules)
  .filter((ruleName) => !ruleName.startsWith('thethracian/'))
  .toSorted();
assert.deepStrictEqual(
  printedNativeRuleNames,
  sourceNativeRuleNames,
  `Oxlint ${minimumPeerVersion} did not register the complete native preset`,
);

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'oxlint-min-peer-'));
const temporarySafePath = join(temporaryDirectory, basename(safePath));

try {
  copyFileSync(safePath, temporarySafePath);
  const beforeFix = readFileSync(temporarySafePath, 'utf8');
  const safeResult = runOxlint(temporarySafePath, ['--fix']);
  const afterFix = readFileSync(temporarySafePath, 'utf8');

  assert.equal(safeResult.status, 0, safeResult.stderr);
  assert.equal(parseDiagnostics(safeResult.stdout).diagnostics.length, 0);
  assert.equal(afterFix, beforeFix);
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true });
}
