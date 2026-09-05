import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const printedConfig = JSON.parse(
  execFileSync(
    'pnpm',
    ['exec', 'oxlint', '--print-config', '-c', 'oxlint.workspace.config.mjs', 'ts/src/index.ts'],
    { cwd: repoRoot, encoding: 'utf8' },
  ),
);

const { default: theThracianOxlint } = await import('../ts/dist/index.js');

const severityOf = (setting) => (Array.isArray(setting) ? setting[0] : setting);

const normalizeSeverity = (severity) => {
  if (severity === 'deny' || severity === 'error') {
    return 'error';
  }
  return severity;
};

const normalizeSetting = (setting) => {
  if (!Array.isArray(setting)) {
    return normalizeSeverity(setting);
  }

  const [severity, ...options] = setting;
  // Oxlint's --print-config representation wraps rule options in one array,
  // while defineConfig accepts the options object directly.
  const unwrappedOptions = options.length === 1 && Array.isArray(options[0]) ? options[0] : options;
  return [normalizeSeverity(severity), ...unwrappedOptions];
};

const nativeEntries = (rules) =>
  Object.entries(rules ?? {}).filter(([ruleName]) => !ruleName.startsWith('thethracian/'));

const sourceConfig = theThracianOxlint({ effect: false, typeAware: true });
const baseSourceConfig = theThracianOxlint({ effect: false });
const sourceNativeEntries = nativeEntries(sourceConfig.rules);
const baseSourceNativeEntries = nativeEntries(baseSourceConfig.rules);
const printedNativeEntries = nativeEntries(printedConfig.rules);

assert.deepStrictEqual(
  sourceConfig.categories,
  { correctness: 'allow' },
  'The source preset must use only the correctness default reset category',
);
assert.deepStrictEqual(
  printedConfig.categories,
  { correctness: 'allow' },
  'The resolved preset must retain only the correctness default reset category',
);

const sourceWarningsOrRemovals = sourceNativeEntries
  .filter(([, setting]) => normalizeSeverity(severityOf(setting)) !== 'error')
  .map(([ruleName]) => ruleName)
  .sort();
assert.deepStrictEqual(
  sourceWarningsOrRemovals,
  [],
  'The source allowlist must contain only error rules; omit noisy rules entirely',
);

const printedWarningsOrRemovals = printedNativeEntries
  .filter(([, setting]) => normalizeSeverity(severityOf(setting)) !== 'error')
  .map(([ruleName]) => ruleName)
  .sort();
assert.deepStrictEqual(
  printedWarningsOrRemovals,
  [],
  'The resolved preset must contain no warnings or off/allow rules',
);

assert.equal(
  baseSourceNativeEntries.length,
  128,
  'base source config must expose 128 syntax-only native rules',
);
assert.equal(
  sourceNativeEntries.length,
  159,
  'type-aware source config must expose 159 native rules',
);
assert.equal(
  printedNativeEntries.length,
  159,
  'resolved type-aware config must expose 159 native rules',
);

const sourceNative = Object.fromEntries(
  sourceNativeEntries.map(([ruleName, setting]) => [ruleName, normalizeSetting(setting)]),
);
const printedNative = Object.fromEntries(
  printedNativeEntries.map(([ruleName, setting]) => [ruleName, normalizeSetting(setting)]),
);
assert.deepStrictEqual(
  printedNative,
  sourceNative,
  'The resolved native rule set changed; update the explicit source allowlist deliberately.',
);

const effectConfig = theThracianOxlint({ effect: true, typeAware: true });
const effectRules = Object.entries(effectConfig.rules ?? {}).filter(([ruleName]) =>
  ruleName.startsWith('thethracian/effect-'),
);
assert.equal(effectRules.length, 18, 'effect: true must enable exactly the safety bucket');
assert.ok(
  effectRules.every(([, setting]) => normalizeSeverity(severityOf(setting)) === 'error'),
  'Active custom Effect rules must all be errors',
);
assert.equal(
  normalizeSeverity(severityOf(effectConfig.rules?.['thethracian/no-service-constructor-imports'])),
  'error',
  'effect: true must enable the service-constructor import rule as an error',
);

console.log(
  `Effective Oxlint policy locked: ${printedNativeEntries.length} native errors, 0 warnings/off rules.`,
);
