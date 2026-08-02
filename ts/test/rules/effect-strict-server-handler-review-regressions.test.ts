import { describe, expect, it } from 'vitest';
import type { Context } from '../../src/rules/effect-rule-core';
import { hasRunSyncInServerRequestHandler } from '../../src/rules/effect-strict-source-predicates';
import { runRule } from './effect-rule-test-utils';
import { runSyncServerHandlerAST } from '../../src/rules/effect-strict-server-handler-ast';

const RULE_NAME = 'effect-no-runSync-in-server-request-handlers';

interface SourceCase {
  name: string;
  source: string;
}

interface SourceRange {
  end: number;
  start: number;
}

const reportsFor = (source: string) => runRule(RULE_NAME, source);

const fallbackObjectPropertyCases: readonly SourceCase[] = [
  {
    name: 'a namespace runSync object property handler',
    source: 'const server = { handler: () => Effect.runSync(program) };',
  },
  {
    name: 'an aliased runSync object property handler',
    source:
      'import { runSync as sync } from "effect/Effect"; const server = { handler: () => sync(program) };',
  },
  {
    name: 'a named runSync alias handler',
    source: 'import { runSync as sync } from "effect/Effect"; const handler = () => sync(program);',
  },
];

const literalHandlerKeyCases: readonly SourceCase[] = [
  {
    name: 'a string-literal object handler key',
    source: 'const server = { "handler": () => Effect.runSync(program) };',
  },
  {
    name: 'a string-literal class handler key',
    source: 'class Server { "handler"() { return Effect.runSync(program); } }',
  },
];

const malformedHandlerRanges: readonly SourceRange[] = [
  { end: 100, start: Number.NaN },
  { end: Number.POSITIVE_INFINITY, start: 0 },
  { end: 100, start: Number.NEGATIVE_INFINITY },
  { end: 100, start: -1 },
  { end: 10, start: 100 },
];

const runASTWithHandlerRange = (handlerRange: SourceRange): object[] => {
  const call = {
    callee: {
      computed: false,
      object: { name: 'Effect', type: 'Identifier' },
      property: { name: 'runSync', type: 'Identifier' },
      type: 'MemberExpression',
    },
    end: 60,
    start: 40,
    type: 'CallExpression',
  };
  const handlerInit = {
    body: { name: 'ok', type: 'Identifier' },
    end: handlerRange.end,
    start: handlerRange.start,
    type: 'ArrowFunctionExpression',
  };
  const declarator = {
    end: 30,
    id: { name: 'handler', type: 'Identifier' },
    init: handlerInit,
    start: 0,
    type: 'VariableDeclarator',
  };
  const unrelatedCall = {
    expression: call,
    end: 60,
    start: 40,
    type: 'ExpressionStatement',
  };
  const program = {
    body: [declarator, unrelatedCall],
    type: 'Program',
  };
  const reports: object[] = [];
  const context: Context = {
    report({ node }): void {
      reports.push(node);
    },
  };
  const visitors = runSyncServerHandlerAST(context);

  visitors.Program?.(program);
  visitors.VariableDeclarator?.(declarator);
  visitors.CallExpression?.(call);

  return reports;
};

describe('effect-no-runSync-in-server-request-handlers review regressions', (): void => {
  it('reports a fallback function handler with a default object parameter', (): void => {
    const source = 'function handler({ request } = {}) { return Effect.runSync(program); }';

    expect(hasRunSyncInServerRequestHandler(source)).toBe(true);
  });

  it('does not report a fallback runSync call in a sibling argument', (): void => {
    const source = 'foo(handler = () => ok, Effect.runSync(program));';

    expect(hasRunSyncInServerRequestHandler(source)).toBe(false);
  });

  it.each(fallbackObjectPropertyCases)(
    'reports $name in the source fallback',
    ({ source }): void => {
      expect(hasRunSyncInServerRequestHandler(source)).toBe(true);
    },
  );

  it.each(literalHandlerKeyCases)('reports $name through the AST visitor', ({ source }): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it.each(malformedHandlerRanges)(
    'ignores an unrelated call for a malformed handler range %#',
    (handlerRange): void => {
      expect(runASTWithHandlerRange(handlerRange)).toHaveLength(0);
    },
  );
});
