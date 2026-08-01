import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import { parseSync } from 'oxc-parser';
import plugin from '../../src/rules/plugin';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-ref-getAndUpdate';
const EXPECTED_MESSAGE =
  'Ref.getAndUpdate expresses a Ref.modify callback that returns the current value while updating the Ref more directly.\n' +
  'Fix: Replace Ref.modify with Ref.getAndUpdate and return only the new Ref value from the callback.\n' +
  'Example:\n```ts\nimport { Ref } from "effect"\n\nconst previous = Ref.getAndUpdate(ref, (current) => current + 1)\n```';

type ReportDescriptor = {
  message: string;
  node: object;
};

type VisitorMap = Record<string, ((node: object) => void) | undefined>;

const root = (statement: string): string => `import { Ref as RootRef } from "effect"; ${statement}`;
const subpath = (statement: string): string =>
  `import * as RefModule from "effect/Ref"; ${statement}`;
const named = (statement: string): string =>
  `import { modify as refModify } from "effect/Ref"; ${statement}`;
const rootNamespace = (statement: string): string => `import * as Root from "effect"; ${statement}`;
const pair = (update = 'current + 1'): string => `[current, ${update}]`;

const registeredRule = (): SourceRule => {
  const rule: unknown = Reflect.get(plugin.rules, RULE_NAME);
  expect(rule, `${RULE_NAME} must be registered`).toBeDefined();
  return rule as SourceRule;
};

const reportsForRule = (source: string) => {
  registeredRule();
  return runRule(RULE_NAME, source);
};

const visitorKeysFor = (source: string): string[] =>
  Object.keys(
    registeredRule().create({
      report(): void {},
      sourceCode: { text: source },
    }),
  ).sort();

const isNode = (value: unknown): value is { type: string } =>
  Boolean(
    value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string',
  );

const traverse = (node: unknown, visitors: VisitorMap): void => {
  if (!isNode(node)) {
    return;
  }
  if (node.type !== 'Program') {
    visitors[node.type]?.(node);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        traverse(child, visitors);
      }
    } else {
      traverse(value, visitors);
    }
  }
};

const reportDescriptorsForRule = (source: string): ReportDescriptor[] => {
  const reports: ReportDescriptor[] = [];
  const visitors = registeredRule().create({
    report(descriptor): void {
      reports.push(descriptor);
    },
    sourceCode: { text: source },
  });
  const program = parseSync('src/domain/ref.ts', source, { sourceType: 'module' }).program;

  visitors.Program(program as object);
  traverse(program, visitors);
  return reports;
};

const positiveCases = [
  ['a root Ref alias', root(`RootRef.modify(ref, (current) => ${pair()});`)],
  ['an effect/Ref namespace', subpath(`RefModule.modify(ref, (current) => ${pair()});`)],
  ['a named modify alias', named(`refModify(ref, (current) => ${pair()});`)],
  ['a Root.Ref namespace', rootNamespace(`Root.Ref.modify(ref, (current) => ${pair()});`)],
  ['a data-first call', root(`RootRef.modify(ref, (current) => ${pair('next')});`)],
  ['a standalone curried call', root(`RootRef.modify((current) => ${pair()});`)],
  ['a directly applied curried call', root(`RootRef.modify((current) => ${pair()})(ref);`)],
  ['a method pipe', root(`ref.pipe(RootRef.modify((current) => ${pair()}));`)],
  ['a functional pipe', root(`pipe(ref, RootRef.modify((current) => ${pair()}));`)],
  ['a bare tuple body', root(`RootRef.modify(ref, (current) => ${pair('next')});`)],
  ['one as const assertion', root(`RootRef.modify(ref, (current) => ${pair()} as const);`)],
  ['a parenthesized body', root(`RootRef.modify(ref, (current) => (${pair()}));`)],
  ['a number update expression', root(`RootRef.modify(ref, (current) => ${pair('current + 1')});`)],
  [
    'a bigint update expression',
    root(`RootRef.modify(ref, (current) => ${pair('current + 1n')});`),
  ],
  [
    'a call update expression',
    root(`RootRef.modify(ref, (current) => ${pair('increment(current)')});`),
  ],
  [
    'an object update expression',
    root(`RootRef.modify(ref, (current) => ${pair('{ current }')});`),
  ],
  [
    'a member update expression',
    root(`RootRef.modify(ref, (current) => ${pair('current.value')});`),
  ],
  [
    'after a parameter shadowing scope ends',
    root(
      `function local(RootRef) { return RootRef.modify(ref, (current) => ${pair()}); } RootRef.modify(ref, (current) => ${pair()});`,
    ),
  ],
] as const;

const negativeCases = [
  ['no import', `RootRef.modify(ref, (current) => ${pair()});`],
  [
    'a foreign root import',
    `import { Ref as RootRef } from "local-ref"; RootRef.modify(ref, (current) => ${pair()});`,
  ],
  [
    'a foreign subpath import',
    `import * as RefModule from "local-ref/Ref"; RefModule.modify(ref, (current) => ${pair()});`,
  ],
  [
    'a type-only declaration import',
    `import type { Ref as RootRef } from "effect"; RootRef.modify(ref, (current) => ${pair()});`,
  ],
  [
    'a type-only import specifier',
    `import { type Ref as RootRef } from "effect"; RootRef.modify(ref, (current) => ${pair()});`,
  ],
  [
    'a type-only namespace import',
    `import type * as RefModule from "effect/Ref"; RefModule.modify(ref, (current) => ${pair()});`,
  ],
  [
    'a type-only named import',
    `import type { modify as refModify } from "effect/Ref"; refModify(ref, (current) => ${pair()});`,
  ],
  [
    'a wrong aliased root export',
    `import { Effect as RootRef } from "effect"; RootRef.modify(ref, (current) => ${pair()});`,
  ],
  ['a direct Root.modify call', rootNamespace(`Root.modify(ref, (current) => ${pair()});`)],
  [
    'a parameter shadowing a root Ref alias',
    root(`const local = (RootRef) => RootRef.modify(ref, (current) => ${pair()});`),
  ],
  [
    'a parameter shadowing a subpath namespace',
    subpath(`const local = (RefModule) => RefModule.modify(ref, (current) => ${pair()});`),
  ],
  [
    'a parameter shadowing a named modify alias',
    named(`const local = (refModify) => refModify(ref, (current) => ${pair()});`),
  ],
  [
    'a parameter shadowing a root namespace',
    rootNamespace(`const local = (Root) => Root.Ref.modify(ref, (current) => ${pair()});`),
  ],
  [
    'a hoisted var shadow',
    root(
      `function local() { { var RootRef = LocalRef; } return RootRef.modify(ref, (current) => ${pair()}); }`,
    ),
  ],
  ['no outer arguments', root('RootRef.modify();')],
  ['one data-first argument', root('RootRef.modify(ref);')],
  ['three data-first arguments', root(`RootRef.modify(ref, (current) => ${pair()}, options);`)],
  ['a spread data-first argument', root(`RootRef.modify(...[ref, (current) => ${pair()}]);`)],
  ['a spread callback argument', root(`RootRef.modify(ref, ...(callbacks));`)],
  ['an optional namespace member', root(`RootRef?.modify(ref, (current) => ${pair()});`)],
  ['an optional call', root(`RootRef.modify?.(ref, (current) => ${pair()});`)],
  ['a computed callee', root(`RootRef["modify"](ref, (current) => ${pair()});`)],
  ['a parenthesized callee', root(`(RootRef.modify)(ref, (current) => ${pair()});`)],
  [
    'an asserted callee',
    root(`(RootRef.modify as typeof RootRef.modify)(ref, (current) => ${pair()});`),
  ],
  ['a non-null callee', root(`RootRef.modify!(ref, (current) => ${pair()});`)],
  ['a generic call', root(`RootRef.modify<number>(ref, (current) => ${pair()});`)],
  ['a zero-parameter callback', root(`RootRef.modify(ref, () => [current, next]);`)],
  ['a two-parameter callback', root(`RootRef.modify(ref, (current, index) => ${pair('index')});`)],
  ['a typed callback parameter', root(`RootRef.modify(ref, (current: number) => ${pair()});`)],
  [
    'an optional callback parameter',
    root(`RootRef.modify(ref, (current?: number) => ${pair('1')});`),
  ],
  ['a default callback parameter', root(`RootRef.modify(ref, (current = 0) => ${pair()});`)],
  ['a rest callback parameter', root(`RootRef.modify(ref, (...current) => [current, current]);`)],
  ['an object callback parameter', root(`RootRef.modify(ref, ({ current }) => ${pair()});`)],
  ['an array callback parameter', root(`RootRef.modify(ref, ([current]) => ${pair()});`)],
  ['an async callback', root(`RootRef.modify(ref, async (current) => ${pair()});`)],
  ['a block callback body', root(`RootRef.modify(ref, (current) => { return ${pair()}; });`)],
  ['a function callback', root(`RootRef.modify(ref, function (current) { return ${pair()}; });`)],
  [
    'a generic callback',
    root(`RootRef.modify(ref, <Value>(current: Value) => [current, current]);`),
  ],
  [
    'an explicit callback return type',
    root(`RootRef.modify(ref, (current): [number, number] => ${pair()});`),
  ],
  [
    'a referenced callback',
    root(`const callback = (current) => ${pair()}; RootRef.modify(ref, callback);`),
  ],
  ['a wrapped callback', root(`RootRef.modify(ref, ((current) => ${pair()}));`)],
  [
    'a raw three-slot tuple with a middle hole',
    root('RootRef.modify(ref, (current) => [current, , next]);'),
  ],
  ['a raw trailing-hole tuple', root('RootRef.modify(ref, (current) => [current,,]);')],
  ['a raw leading-hole tuple', root('RootRef.modify(ref, (current) => [, next]);')],
  ['an empty tuple', root('RootRef.modify(ref, (current) => []);')],
  ['a one-slot tuple', root('RootRef.modify(ref, (current) => [current]);')],
  ['a three-element tuple', root('RootRef.modify(ref, (current) => [current, next, later]);')],
  ['a first spread tuple element', root('RootRef.modify(ref, (current) => [...values]);')],
  [
    'a second spread tuple element',
    root('RootRef.modify(ref, (current) => [current, ...values]);'),
  ],
  [
    'a calculated first tuple element',
    root(`RootRef.modify(ref, (current) => ${pair('next').replace('current', 'current + 0')});`),
  ],
  [
    'a parenthesized first tuple element',
    root('RootRef.modify(ref, (current) => [(current), next]);'),
  ],
  [
    'an asserted first tuple element',
    root('RootRef.modify(ref, (current) => [current as number, next]);'),
  ],
  ['a non-null first tuple element', root('RootRef.modify(ref, (current) => [current!, next]);')],
  ['a non-const tuple assertion', root(`RootRef.modify(ref, (current) => ${pair()} as Pair);`)],
  ['a satisfies tuple body', root(`RootRef.modify(ref, (current) => (${pair()} satisfies Pair));`)],
  ['a non-null tuple body', root(`RootRef.modify(ref, (current) => ${pair()}!);`)],
  ['an unchanged Ref update', root('RootRef.modify(ref, (current) => [current, current]);')],
  ['the canonical getAndUpdate call', root('RootRef.getAndUpdate(ref, (current) => current + 1);')],
  [
    'an unrelated Ref.modify result tuple',
    root('RootRef.modify(ref, (current) => [next, current]);'),
  ],
] as const;

describe('effect-prefer-ref-getAndUpdate', (): void => {
  it('is registered as a problem and enabled as a default error', (): void => {
    const rule = registeredRule();

    expect(rule.meta?.type).toBe('problem');
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each([
    ['effect', 'Ref modify => ['],
    ['Ref', 'effect modify => ['],
    ['modify', 'effect Ref => ['],
    ['=>', 'effect Ref modify ['],
    ['[', 'effect Ref modify =>'],
  ])('keeps only Program when the source is missing %s', (_token, source): void => {
    expect(visitorKeysFor(source)).toStrictEqual(['Program']);
  });

  it('enables CallExpression analysis when every candidate token starts at offset zero', (): void => {
    expect(visitorKeysFor('effect Ref modify => [')).toStrictEqual(['CallExpression', 'Program']);
  });

  it.each(positiveCases)('reports %s', (_name, source): void => {
    expect(reportsForRule(source)).toHaveLength(1);
  });

  it('reports every independent occurrence', (): void => {
    expect(
      reportsForRule(
        root(
          `RootRef.modify(first, (current) => ${pair()}); RootRef.modify(second, (current) => ${pair('current - 1')});`,
        ),
      ),
    ).toHaveLength(2);
  });

  it('publishes the frozen diagnostic without a fix or suggestions', (): void => {
    const [report] = reportDescriptorsForRule(root(`RootRef.modify(ref, (current) => ${pair()});`));

    expect(report?.message).toBe(EXPECTED_MESSAGE);
    expect(Reflect.get(report ?? {}, 'fix')).toBeUndefined();
    expect(Reflect.get(report ?? {}, 'suggest')).toBeUndefined();
    expect(Reflect.get(report ?? {}, 'suggestions')).toBeUndefined();
  });

  it.each([
    [
      'a namespace member',
      rootNamespace(`Root.Ref.modify(ref, (current) => ${pair()});`),
      'Root.Ref.modify',
    ],
    ['a named alias', named(`refModify(ref, (current) => ${pair()});`), 'refModify'],
  ])('reports the exact callee location for %s', (_name, source, expected): void => {
    const [report] = reportsForRule(source);
    const node = report?.node as { end?: number; start?: number } | undefined;

    expect(source.slice(node?.start, node?.end)).toBe(expected);
  });

  it.each(negativeCases)('does not report %s', (_name, source): void => {
    expect(reportsForRule(source)).toHaveLength(0);
  });
});
