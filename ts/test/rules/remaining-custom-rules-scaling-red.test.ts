import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import countImportDepth from '../../src/rules/max-import-depth';
import findLongLines from '../../src/rules/max-line-length';
import findMisCasedAcronyms from '../../src/rules/acronym-case';
import { findRequiredFunctionDocFailure } from '../../src/rules/require-function-doc';
import hasRequiredFileDoc from '../../src/rules/require-file-doc';
import { parseSync } from 'oxc-parser';
import { performance } from 'node:perf_hooks';
import plugin from '../../src/rules/plugin';

const documentedExports = (count: number): string =>
  Array.from(
    { length: count },
    (_, index) =>
      `/** Function ${index}. */\nexport function function${index}(): number { return ${index}; }\n`,
  ).join('');

const measure = <Result>(
  run: (input: string) => Result,
  input: string,
): { duration: number; result: Result } => {
  run(input);
  const startedAt = performance.now();
  const result = run(input);
  return { duration: performance.now() - startedAt, result };
};

const callNamed = (program: object, name: string): object | undefined => {
  const pending: unknown[] = [program];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== 'object') {
      continue;
    }
    const node = value as {
      callee?: { property?: { name?: string }; type?: string };
      type?: string;
    };
    if (node.type === 'CallExpression' && node.callee?.property?.name === name) {
      return value;
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        pending.push(...child);
      } else {
        pending.push(child);
      }
    }
  }
  return undefined;
};

const runNestedASTRule = (
  ruleName: string,
  wrapperName: string,
  yieldedExpression: string,
): number => {
  const depth = 2_048;
  const nestedValue = `${'['.repeat(depth)}0${']'.repeat(depth)}`;
  const source =
    wrapperName === 'gen'
      ? `import { Effect } from 'effect'; Effect.gen(function* () { const value = ${nestedValue}; yield* ${yieldedExpression}; });`
      : `import { Effect } from 'effect'; Effect.promise(() => ${'['.repeat(depth)}${yieldedExpression}${']'.repeat(depth)});`;
  const program = parseSync('nested.ts', source, { sourceType: 'module' }).program as object;
  const rule: SourceRule = Reflect.get(plugin.rules, ruleName) as SourceRule;
  const reports: object[] = [];
  const visitors = rule.create({
    report({ node }): void {
      reports.push(node);
    },
    sourceCode: { text: source },
  });
  visitors.Program(program);
  const call = callNamed(program, wrapperName);
  if (call !== undefined) {
    visitors.CallExpression?.(call);
  }
  return reports.length;
};

const runNestedMapFallbackRule = (): number => {
  const depth = 2_048;
  const nestedValue = `${'['.repeat(depth)}Effect.flatMap(Effect.succeed(1), (value) => Effect.succeed(value))${']'.repeat(depth)}`;
  const source = `import { Effect } from 'effect'; const value = ${nestedValue};`;
  const program = parseSync('nested.ts', source, { sourceType: 'module' }).program as object;
  const rule: SourceRule = Reflect.get(
    plugin.rules,
    'effect-prefer-map-over-flatMap-succeed',
  ) as SourceRule;
  const reports: object[] = [];
  const visitors = rule.create({
    report({ node }): void {
      reports.push(node);
    },
    sourceCode: { text: source },
  });
  visitors.Program(program);
  return reports.length;
};

describe('remaining custom Oxlint rule scaling regressions', (): void => {
  it('handles deeply nested relative import paths without recursion overflow', (): void => {
    const depth = 4_096;

    expect(countImportDepth('../'.repeat(depth) + 'module')).toBe(depth);
  });

  it('handles large leading whitespace without recursion overflow', (): void => {
    const source = `${' '.repeat(2_048)}export const value = 1;`;

    expect(hasRequiredFileDoc(source)).toBe(false);
  });

  it('handles long identifier digit suffixes without recursion overflow', (): void => {
    const identifier = `aHTTP${'7'.repeat(4_096)}B`;

    expect(findMisCasedAcronyms(identifier)).toEqual([]);
  });

  it.each([
    ['effect-prefer-all-discard', 'gen', 'Effect.all([value])'],
    ['effect-prefer-forEach-discard', 'gen', 'Effect.forEach([value], work)'],
    ['effect-no-global-fetch', 'promise', 'fetch()'],
  ])(
    'walks deeply nested ASTs for %s without recursion overflow',
    (ruleName, wrapperName, expression): void => {
      expect(runNestedASTRule(ruleName, wrapperName, expression)).toBe(1);
    },
  );

  it('keeps the legacy AST fallback for effect-prefer-map-over-flatMap-succeed stack-safe', (): void => {
    expect(runNestedMapFallbackRule()).toBe(1);
  });

  it('keeps exported documentation checks near-linear as exports grow', (): void => {
    const smallMeasurement = measure(findRequiredFunctionDocFailure, documentedExports(256));
    const largeMeasurement = measure(findRequiredFunctionDocFailure, documentedExports(1_024));

    expect(largeMeasurement.result).toBeUndefined();
    expect(largeMeasurement.duration / smallMeasurement.duration).toBeLessThan(8);
  }, 15_000);

  it('keeps long-line collection near-linear as violating lines grow', (): void => {
    const smallSource = ('x'.repeat(160) + '\n').repeat(1_000);
    const largeSource = ('x'.repeat(160) + '\n').repeat(8_000);
    const smallMeasurement = measure(findLongLines, smallSource);
    const largeMeasurement = measure(findLongLines, largeSource);

    expect(largeMeasurement.result).toHaveLength(8_000);
    expect(largeMeasurement.duration / smallMeasurement.duration).toBeLessThan(16);
  }, 15_000);
});
