import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import theThracianOxlint from '../src/index';

const adoptedNativeRules = [
  'array-callback-return',
  'jest/no-disabled-tests',
  'jest/no-focused-tests',
  'no-case-declarations',
  'no-fallthrough',
  'no-self-compare',
  'no-useless-assignment',
  'no-var',
  'oxc/bad-bitwise-operator',
  'oxc/no-accumulating-spread',
  'promise/no-return-in-finally',
  'typescript/ban-ts-comment',
  'typescript/no-empty-object-type',
  'typescript/no-non-null-asserted-nullish-coalescing',
  'typescript/no-unsafe-function-type',
] as const;

const oxlintBinary = join(import.meta.dirname, '..', '..', 'node_modules', '.bin', 'oxlint');

const invalidSource = [
  'export function pick(input: number): number {',
  '  let result = 0;',
  '  switch (input) {',
  '    case 1:',
  '      result = 1;',
  '    case 2: {',
  '      result = 2;',
  '      break;',
  '    }',
  '    case 3:',
  '      const three = 3;',
  '      result = three;',
  '      break;',
  '    default:',
  '      break;',
  '  }',
  '  return result;',
  '}',
  'export const same = (value: number): boolean => value < value;',
  'export const mapped = [1].map((value) => { value + 1; });',
  'export const settled = (): Promise<number> => Promise.resolve(1).finally(() => { return 2; });',
  'declare const maybe: { a?: number } | undefined;',
  'export const merged = maybe | {};',
  'var legacy = 1;',
  '// @ts-ignore',
  'export const ignored: number = legacy;',
  "test.only('focused', () => {});",
  "it.skip('skipped', () => {});",
  "describe.skip('skipped suite', () => {});",
  "xit('prefixed skip', () => {});",
  "test('bodiless placeholder');",
  'declare const settings: { label?: string };',
  "export const forced = settings.label! ?? 'fallback';",
  'export const grown = [1, 2].reduce((all, value) => [...all, value], [] as number[]);',
  'export type AnyFunction = Function;',
  'export type Empty = {};',
  'export const overwritten = (): number => { let value = 1; value = 2; value = 3; return value; };',
  '// @nocommit',
  '// oxlint-disable-next-line no-debugger',
  'export const done = 1;',
  '',
].join('\n');

const legitimateSkipSource = [
  "import { describe, it, test } from 'vitest';",
  'declare const onWindows: boolean;',
  "it.skipIf(onWindows)('conditional skip', () => {});",
  "it.runIf(onWindows)('conditional run', () => {});",
  "describe.skipIf(onWindows)('conditional suite', () => {});",
  "test.todo('planned test');",
  "it('runtime skip', (context) => { context.skip(); });",
  "it.each([1, 2])('parameterised %i', () => {});",
  '',
].join('\n');

const workspace = mkdtempSync(join(tmpdir(), 'thx-adopted-rules-'));

afterAll((): void => {
  rmSync(workspace, { force: true, recursive: true });
});

const nativeOnlyConfig = (): Record<string, unknown> => {
  const config = theThracianOxlint();
  const rules = Object.fromEntries(
    Object.entries(config.rules ?? {}).filter(([ruleName]) => !ruleName.startsWith('thethracian/')),
  );
  return { categories: config.categories, options: config.options, plugins: config.plugins, rules };
};

const lintFixture = (
  name = 'adopted.test.ts',
  source = invalidSource,
): readonly { code?: string; message: string }[] => {
  const configPath = join(workspace, '.oxlintrc.json');
  const fixturePath = join(workspace, name);
  writeFileSync(configPath, JSON.stringify(nativeOnlyConfig()));
  writeFileSync(fixturePath, source);
  const result = spawnSync(oxlintBinary, ['-c', configPath, '-f', 'json', fixturePath], {
    cwd: workspace,
    encoding: 'utf8',
  });
  const report = JSON.parse(result.stdout) as {
    diagnostics: { code?: string; message: string; severity: string }[];
  };
  expect(report.diagnostics.every(({ severity }) => severity === 'error')).toBe(true);
  return report.diagnostics;
};

describe('adopted correctness rules', (): void => {
  it.each(adoptedNativeRules)('enables %s as an error in the syntax-only preset', (ruleName) => {
    const setting = theThracianOxlint().rules?.[ruleName];
    expect(Array.isArray(setting) ? setting[0] : setting).toBe('error');
  });

  it('bans only the @nocommit marker, not TODO or FIXME comments', (): void => {
    expect(theThracianOxlint().rules).toHaveProperty('no-warning-comments', [
      'error',
      { terms: ['@nocommit'] },
    ]);
  });

  it('enables the jest plugin so focused tests are caught in every test runner', (): void => {
    expect(theThracianOxlint().plugins).toContain('jest');
  });

  it('reports unused disable directives as errors in both modes', (): void => {
    expect(theThracianOxlint().options).toStrictEqual({ reportUnusedDisableDirectives: 'error' });
    expect(theThracianOxlint({ typeAware: true }).options).toStrictEqual({
      reportUnusedDisableDirectives: 'error',
      typeAware: true,
      typeCheck: true,
    });
  });

  it('reports every adopted rule through the real Oxlint binary', (): void => {
    const diagnostics = lintFixture();
    const codes = new Set(
      diagnostics.map(({ code = '' }) => code.replace(/^([^()]+)\((.+)\)$/u, '$1/$2')),
    );
    const expected = [...adoptedNativeRules, 'no-warning-comments'].map((ruleName) =>
      ruleName.includes('/') ? ruleName : `eslint/${ruleName}`,
    );

    for (const ruleName of expected) {
      expect(codes, ruleName).toContain(ruleName);
    }
    expect(diagnostics.map(({ message }) => message)).toContain(
      'Unused oxlint-disable directive (no problems were reported).',
    );
  });

  it('reports every unconditional skip form as a disabled test', (): void => {
    const disabled = lintFixture().filter(({ code }) => code === 'jest(no-disabled-tests)');
    expect(disabled).toHaveLength(4);
  });

  it('allows conditional, planned, runtime, and parameterised tests', (): void => {
    expect(lintFixture('legitimate-skips.test.ts', legitimateSkipSource)).toStrictEqual([]);
  });
});
