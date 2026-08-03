import { describe, expect, it } from 'vitest';
import { findStatementEnd, isInsideCall } from '../../src/rules/effect-source-navigation';
import { sourceNavigationIndex } from '../../src/rules/effect-source-navigation-index';

const CALL_PATTERN = /Effect\.runPromise\s*\(/g;

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
