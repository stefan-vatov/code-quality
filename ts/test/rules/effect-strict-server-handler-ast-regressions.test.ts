import { describe, expect, it } from 'vitest';
import { hasRunSyncInServerRequestHandler } from '../../src/rules/effect-strict-source-predicates';
import { runRule } from './effect-rule-test-utils';

const RULE_NAME = 'effect-no-runSync-in-server-request-handlers';

interface SourceCase {
  name: string;
  source: string;
}

const reportsFor = (source: string) => runRule(RULE_NAME, source);

const objectHandlerCases: readonly SourceCase[] = [
  {
    name: 'an object literal property handler',
    source: 'const server = { handler: () => Effect.runSync(program) };',
  },
  {
    name: 'an object method shorthand handler',
    source: 'const server = { handler() { return Effect.runSync(program); } };',
  },
];

const classHandlerCases: readonly SourceCase[] = [
  {
    name: 'an instance handler method',
    source: 'class Server { handler() { return Effect.runSync(program); } }',
  },
  {
    name: 'an instance route method',
    source: 'class Server { route() { return Effect.runSync(program); } }',
  },
  {
    name: 'an instance loader method',
    source: 'class Server { loader() { return Effect.runSync(program); } }',
  },
  {
    name: 'an instance action method',
    source: 'class Server { action() { return Effect.runSync(program); } }',
  },
  {
    name: 'a static handler method',
    source: 'class Server { static handler() { return Effect.runSync(program); } }',
  },
  {
    name: 'a static route method',
    source: 'class Server { static route() { return Effect.runSync(program); } }',
  },
  {
    name: 'a static loader method',
    source: 'class Server { static loader() { return Effect.runSync(program); } }',
  },
  {
    name: 'a static action method',
    source: 'class Server { static action() { return Effect.runSync(program); } }',
  },
];

const safeNameCases: readonly SourceCase[] = [
  {
    name: 'a computed object property whose name is dynamic',
    source:
      'const handler = "handler"; const server = { [handler]: () => Effect.runSync(program) };',
  },
  {
    name: 'a computed class method whose name is dynamic',
    source: 'const route = "route"; class Server { [route]() { return Effect.runSync(program); } }',
  },
  {
    name: 'an object property with a different name',
    source: 'const server = { handle: () => Effect.runSync(program) };',
  },
  {
    name: 'a class method with a different name',
    source: 'class Server { handle() { return Effect.runSync(program); } }',
  },
];

const aliasCases: readonly SourceCase[] = [
  {
    name: 'a named root Effect import alias',
    source: 'import { Effect as Fx } from "effect"; const handler = () => Fx.runSync(program);',
  },
  {
    name: 'a root Effect namespace alias',
    source: 'import * as Fx from "effect"; const handler = () => Fx.Effect.runSync(program);',
  },
  {
    name: 'a named runSync import alias',
    source: 'import { runSync as sync } from "effect/Effect"; const handler = () => sync(program);',
  },
  {
    name: 'an Effect module namespace alias',
    source: 'import * as Fx from "effect/Effect"; const handler = () => Fx.runSync(program);',
  },
];

const shadowedAliasCases: readonly SourceCase[] = [
  {
    name: 'a named root Effect alias shadowed by a handler parameter',
    source: 'import { Effect as Fx } from "effect"; const handler = (Fx) => Fx.runSync(program);',
  },
  {
    name: 'a named runSync alias shadowed by a handler parameter',
    source:
      'import { runSync as sync } from "effect/Effect"; const handler = (sync) => sync(program);',
  },
  {
    name: 'an Effect namespace alias shadowed by a handler parameter',
    source: 'import * as Fx from "effect"; const handler = (Fx) => Fx.Effect.runSync(program);',
  },
];

const directFallbackCases: readonly SourceCase[] = [
  {
    name: 'a direct handler assignment',
    source: 'const handler = () => Effect.runSync(program);',
  },
  {
    name: 'a direct named handler function',
    source: 'function route() { return Effect.runSync(program); }',
  },
  {
    name: 'a direct handler member assignment',
    source: 'server.loader = () => Effect.runSync(program);',
  },
];

describe('effect-no-runSync-in-server-request-handlers AST regressions', (): void => {
  it.each(objectHandlerCases)('reports $name', ({ source }): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it.each(classHandlerCases)('reports $name', ({ source }): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it.each(safeNameCases)('accepts $name', ({ source }): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each(aliasCases)('reports $name', ({ source }): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it.each(shadowedAliasCases)('accepts $name', ({ source }): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });
});

describe('effect-no-runSync-in-server-request-handlers direct fallback parity', (): void => {
  it.each(directFallbackCases)('keeps $name aligned', ({ source }): void => {
    expect(reportsFor(source)).toHaveLength(1);
    expect(hasRunSyncInServerRequestHandler(source)).toBe(true);
  });
});
