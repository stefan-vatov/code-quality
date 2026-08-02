import { describe, expect, it } from 'vitest';
import { findStatementEnd, isInsideCall } from '../../src/rules/effect-source-navigation';
import { performance } from 'node:perf_hooks';
import { sourceNavigationIndex } from '../../src/rules/effect-source-navigation-index';

const CALL_PATTERN = /Effect\.runPromise\s*\(/g;
const QUERY_ITERATIONS = 1_024;
const STATEMENT_QUERY_ITERATIONS = 8_192;
const SCALING_RATIO_LIMIT = 32;
const SCALING_ABSOLUTE_LIMIT_MS = 4_000;
const SCALING_OVERHEAD_MS = 10;

interface TimingResult {
  checksum: number;
  elapsedMs: number;
}

const makeNestedBraceSource = (depth: number): string =>
  `{${'{'.repeat(depth)}value${'}'.repeat(depth)} target}`;

const makeNestedStatementSource = (count: number): string =>
  `const value = [${'fn(fn(value)), '.repeat(count)}done];`;

const measureWarmedQueries = (
  query: () => number,
  iterations: number = QUERY_ITERATIONS,
): TimingResult => {
  for (let index = 0; index < iterations; index += 1) {
    query();
  }
  let checksum = 0;
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    checksum += query();
  }
  return { checksum, elapsedMs: performance.now() - start };
};

const expectSublinearScaling = (
  small: TimingResult,
  large: TimingResult,
  expectedSmallChecksum: number,
  expectedLargeChecksum: number,
): void => {
  expect(small.checksum).toBe(expectedSmallChecksum);
  expect(large.checksum).toBe(expectedLargeChecksum);
  expect(large.elapsedMs).toBeLessThan(SCALING_ABSOLUTE_LIMIT_MS);
  expect(large.elapsedMs).toBeLessThan(small.elapsedMs * SCALING_RATIO_LIMIT + SCALING_OVERHEAD_MS);
};

describe('isInsideCall lexical parity', (): void => {
  it.each([
    {
      label: 'template text',
      source: 'const text = `Effect.runPromise(target)`; consume(target);',
      shouldBeInside: false,
    },
    {
      label: 'line comment',
      source: '// Effect.runPromise(target)\nconsume(target);',
      shouldBeInside: false,
    },
    {
      label: 'block comment',
      source: '/* Effect.runPromise(target) */ consume(target);',
      shouldBeInside: false,
    },
    {
      label: 'regex literal',
      source: 'const matcher = /Effect.runPromise(target)/; consume(target);',
      shouldBeInside: false,
    },
    {
      label: 'code call',
      source: 'Effect.runPromise(target);',
      shouldBeInside: true,
    },
  ])(
    'should classify $label call-pattern text by lexical context',
    ({ source, shouldBeInside }): void => {
      const targetIndex = source.indexOf('target');

      expect(targetIndex).toBeGreaterThanOrEqual(0);
      expect(isInsideCall(source, targetIndex, CALL_PATTERN)).toBe(shouldBeInside);
    },
  );
});

describe('source navigation index scaling', (): void => {
  it('should keep deeply nested enclosing-brace queries sublinear after warmup', (): void => {
    const smallSource = makeNestedBraceSource(500);
    const largeSource = makeNestedBraceSource(16_000);
    const smallIndex = sourceNavigationIndex(smallSource);
    const largeIndex = sourceNavigationIndex(largeSource);
    const smallTarget = smallSource.indexOf('target');
    const largeTarget = largeSource.indexOf('target');
    const smallTiming = measureWarmedQueries(
      (): number => smallIndex.enclosingBraceOpen(smallTarget) + 1,
    );
    const largeTiming = measureWarmedQueries(
      (): number => largeIndex.enclosingBraceOpen(largeTarget) + 1,
    );

    expectSublinearScaling(smallTiming, largeTiming, QUERY_ITERATIONS, QUERY_ITERATIONS);
  });

  it('should keep deeply nested statement-end queries sublinear after warmup', (): void => {
    const smallSource = makeNestedStatementSource(66);
    const largeSource = makeNestedStatementSource(2_200);
    const smallIndex = sourceNavigationIndex(smallSource);
    const largeIndex = sourceNavigationIndex(largeSource);
    const smallTarget = smallSource.indexOf('fn(');
    const largeTarget = largeSource.indexOf('fn(');
    const smallTiming = measureWarmedQueries(
      (): number => smallIndex.statementEnd(smallTarget),
      STATEMENT_QUERY_ITERATIONS,
    );
    const largeTiming = measureWarmedQueries(
      (): number => largeIndex.statementEnd(largeTarget),
      STATEMENT_QUERY_ITERATIONS,
    );

    expectSublinearScaling(
      smallTiming,
      largeTiming,
      (smallSource.length - 1) * STATEMENT_QUERY_ITERATIONS,
      (largeSource.length - 1) * STATEMENT_QUERY_ITERATIONS,
    );
  });
});

describe('findStatementEnd target-stack semantics', (): void => {
  it.each([
    {
      label: 'callback argument before its body',
      source: 'const result = outer(argument, () => { inner(); }); next();',
      target: 'argument',
      expected: '});',
    },
    {
      label: 'callback target stack',
      source: 'const result = outer(() => { inner(); }); next();',
      target: 'inner',
      expected: 'inner();',
    },
    {
      label: 'nested block callback',
      source: 'const value = block({ nested: () => { inner(); } }); next();',
      target: 'nested',
      expected: '});',
    },
    {
      label: 'for header before its delimiter',
      source: 'for (let i = 0; i < limit; i++) { body(); } next();',
      target: 'for',
      expected: 'next();',
    },
    {
      label: 'for header with nested callback',
      source: 'for (let i = 0; i < call(() => { inner(); }); i++) { body(); } next();',
      target: 'i < call',
      expected: '});',
    },
  ])('should ignore child semicolons for a $label target', ({ source, target, expected }): void => {
    const targetIndex = source.indexOf(target);
    const expectedIndex = source.indexOf(';', source.indexOf(expected));

    expect(targetIndex).toBeGreaterThanOrEqual(0);
    expect(expectedIndex).toBeGreaterThanOrEqual(0);
    expect(findStatementEnd(source, targetIndex)).toBe(expectedIndex);
  });
});

describe('source navigation index query contracts', (): void => {
  it('should reuse cached indexes and preserve delimiter boundaries', (): void => {
    const source = '{const value = fn(value);}';
    const index = sourceNavigationIndex(source);
    const cachedIndex = sourceNavigationIndex(source);
    const braceOpen = source.indexOf('{');
    const braceClose = source.indexOf('}');
    const callOpen = source.indexOf('(');
    const callClose = source.indexOf(')');
    const statementEnd = source.indexOf(';');

    expect(cachedIndex).toBe(index);
    expect(index.enclosingBraceOpen(braceOpen)).toBe(-1);
    expect(index.enclosingBraceOpen(braceOpen + 1)).toBe(braceOpen);
    expect(index.enclosingBraceOpen(braceClose)).toBe(braceOpen);
    expect(index.enclosingBraceOpen(braceClose + 1)).toBe(-1);
    expect(index.matchingBrace(braceOpen)).toBe(braceClose);
    expect(index.matchingBrace(braceClose)).toBe(-1);
    expect(index.matchingCall(callOpen)).toBe(callClose);
    expect(index.matchingCall(callClose)).toBe(source.length - 1);
    expect(index.statementEnd(0)).toBe(source.length - 1);
    expect(index.statementEnd(callOpen)).toBe(statementEnd);
    expect(findStatementEnd(source, callOpen)).toBe(statementEnd);
  });

  it('should preserve unmatched-delimiter results at source boundaries', (): void => {
    const source = '{const value = fn(value;';
    const index = sourceNavigationIndex(source);
    const braceOpen = source.indexOf('{');
    const callOpen = source.indexOf('(');
    const statementEnd = source.indexOf(';');

    expect(index.enclosingBraceOpen(-1)).toBe(-1);
    expect(index.enclosingBraceOpen(braceOpen)).toBe(-1);
    expect(index.enclosingBraceOpen(source.length)).toBe(braceOpen);
    expect(index.matchingBrace(braceOpen)).toBe(-1);
    expect(index.matchingCall(callOpen)).toBe(source.length - 1);
    expect(index.statementEnd(0)).toBe(source.length - 1);
    expect(index.statementEnd(statementEnd)).toBe(statementEnd);
    expect(findStatementEnd(source, source.length)).toBe(source.length - 1);
  });
});
