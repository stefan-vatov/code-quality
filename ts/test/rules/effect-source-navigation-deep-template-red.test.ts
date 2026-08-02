import { describe, expect, it } from 'vitest';
import { findBalancedCallEnd, findMatchingBrace } from '../../src/rules/effect-source-scan';
import { findStatementEnd, isInsideCall } from '../../src/rules/effect-source-navigation';
import { parseSync } from 'oxc-parser';
import { sourceNavigationIndex } from '../../src/rules/effect-source-navigation-index';

const CALL_PATTERN = /Effect\.runPromise\s*\(/g;
const SHALLOW_TEMPLATE_DEPTH = 2;
const DEEP_TEMPLATE_DEPTH = 1_000;
const TEMPLATE_QUOTE = String.fromCharCode(96);

const nestedTemplate = (depth: number): string => {
  let expression = 'leaf';
  for (let index = 0; index < depth; index += 1) {
    expression = `${TEMPLATE_QUOTE}\${${expression}}${TEMPLATE_QUOTE}`;
  }
  return expression;
};

const parserRelevantSource = (depth: number): string =>
  [
    'const leaf = 1;',
    `const value = ${nestedTemplate(depth)};`,
    'function run() {',
    '  return Effect.runPromise(value);',
    '}',
    'run();',
  ].join('\n');

describe('source navigation nested template interpolation stack safety', (): void => {
  it('preserves shallow parser-valid navigation across direct and public callers', (): void => {
    const source = parserRelevantSource(SHALLOW_TEMPLATE_DEPTH);
    const parseResult = parseSync('deep-template.ts', source, { sourceType: 'module' });
    const navigation = sourceNavigationIndex(source);
    const functionOpen = source.indexOf('{', source.indexOf('function run'));
    const functionClose = source.indexOf('}', functionOpen);
    const callOpen = source.indexOf('(', source.indexOf('Effect.runPromise'));
    const callClose = source.indexOf(')', callOpen);
    const callTarget = source.indexOf('value', callOpen);
    const returnTarget = source.indexOf('return');

    expect(parseResult.errors).toHaveLength(0);
    expect(navigation.matchingBrace(functionOpen)).toBe(functionClose);
    expect(navigation.matchingCall(callOpen)).toBe(callClose);
    expect(navigation.enclosingBraceOpen(callTarget)).toBe(functionOpen);
    expect(findBalancedCallEnd(source, callOpen)).toBe(callClose);
    expect(findMatchingBrace(source, functionOpen)).toBe(functionClose);
    expect(findStatementEnd(source, returnTarget)).toBe(source.indexOf(';', callClose));
    expect(isInsideCall(source, callTarget, CALL_PATTERN)).toBe(true);
  });

  it('does not throw or lose call navigation at the reported interpolation depth', (): void => {
    const source = parserRelevantSource(DEEP_TEMPLATE_DEPTH);
    const parseResult = parseSync('deep-template.ts', source, { sourceType: 'module' });
    const functionOpen = source.indexOf('{', source.indexOf('function run'));
    const functionClose = source.indexOf('}', functionOpen);
    const callOpen = source.indexOf('(', source.indexOf('Effect.runPromise'));
    const callClose = source.indexOf(')', callOpen);
    const callTarget = source.indexOf('value', callOpen);
    const returnTarget = source.indexOf('return');
    let directCallEnd: number | undefined;
    let publicCallEnd: number | undefined;
    let publicBraceEnd: number | undefined;
    let publicStatementEnd: number | undefined;
    let publicInsideCall: boolean | undefined;

    expect(parseResult.errors).toHaveLength(0);
    expect
      .soft((): void => {
        directCallEnd = sourceNavigationIndex(source).matchingCall(callOpen);
      })
      .not.toThrow();
    expect
      .soft((): void => {
        publicCallEnd = findBalancedCallEnd(source, callOpen);
      })
      .not.toThrow();
    expect
      .soft((): void => {
        publicBraceEnd = findMatchingBrace(source, functionOpen);
      })
      .not.toThrow();
    expect
      .soft((): void => {
        publicStatementEnd = findStatementEnd(source, returnTarget);
      })
      .not.toThrow();
    expect
      .soft((): void => {
        publicInsideCall = isInsideCall(source, callTarget, CALL_PATTERN);
      })
      .not.toThrow();
    if (directCallEnd !== undefined) {
      expect(directCallEnd).toBe(callClose);
    }
    if (publicCallEnd !== undefined) {
      expect(publicCallEnd).toBe(callClose);
    }
    if (publicBraceEnd !== undefined) {
      expect(publicBraceEnd).toBe(functionClose);
    }
    if (publicStatementEnd !== undefined) {
      expect(publicStatementEnd).toBe(source.indexOf(';', callClose));
    }
    if (publicInsideCall !== undefined) {
      expect(publicInsideCall).toBe(true);
    }
  });
});
