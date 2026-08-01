import { describe, expect, it } from 'vitest';
import { runAllRules, runRule } from './effect-rule-test-utils';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import plugin from '../../src/rules/plugin';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-filterOrFail-over-flatMap-guard';
const EXPECTED_MESSAGE =
  "Effect.filterOrFail expresses validating an Effect's success value with a predicate more directly than " +
  'Effect.flatMap with Effect.succeed and Effect.fail branches.\n' +
  'Fix: Replace Effect.flatMap with Effect.filterOrFail, keep the condition in a predicate callback, and ' +
  'return the failure value from the lazy error callback.\n' +
  'Example:\n```ts\nimport { Effect } from "effect"\n\n' +
  'const activeUser = loadUser.pipe(\n' +
  '  Effect.filterOrFail(\n' +
  '    (user) => user.isActive === true,\n' +
  '    () => new InactiveUserError()\n' +
  '  )\n' +
  ')\n```';

const imported = (statement: string): string => `import { Effect } from "effect"; ${statement}`;
const READY = 'value.ready === true';
const SUCCESS = 'Effect.succeed(value)';
const FAILURE = 'Effect.fail(new Rejected())';
const BRANCHES = `${READY} ? ${SUCCESS} : ${FAILURE}`;
const effectCall = (callee: string, argumentsSource: string): string =>
  imported(`${callee}(${argumentsSource});`);
const flatMap = (callback: string): string => effectCall('Effect.flatMap', `source, ${callback}`);
const arrowGuard = (parameters: string, condition = READY): string =>
  `(${parameters}) => ${condition} ? ${SUCCESS} : ${FAILURE}`;
const functionGuard = (header: string, condition = READY): string =>
  `${header} { return ${condition} ? ${SUCCESS} : ${FAILURE}; }`;
const blockGuard = (...statements: string[]): string =>
  flatMap(`value => { ${statements.join(' ')} }`);
const guard = (condition: string, success = SUCCESS, failure = FAILURE): string =>
  flatMap(`value => ${condition} ? ${success} : ${failure}`);
const failingGuard = (condition: string, error: string): string =>
  guard(condition, undefined, `Effect.fail(${error})`);
const directGuard = (declaration = ''): string =>
  `${declaration}${declaration ? '; ' : ''}Effect.flatMap(source, value => ${BRANCHES});`;
const namedShadow = (name: string, type: string): string =>
  `import { flatMap, succeed, fail } from "effect/Effect"; const run = (${name}: ${type}) => ` +
  `flatMap(source, value => ${READY} ? succeed(value) : fail(new Rejected()));`;
const reportsFor = (source: string) => runRule(RULE_NAME, source);

const registeredRule = (): SourceRule => {
  const rule: unknown = Reflect.get(plugin.rules, RULE_NAME);
  expect(rule, `${RULE_NAME} must be registered`).toBeDefined();
  return rule as SourceRule;
};

const visitorKeysFor = (source: string): string[] =>
  Object.keys(
    registeredRule().create({
      report(): void {},
      sourceCode: { text: source },
    }),
  ).sort();

describe('effect-prefer-filterOrFail-over-flatMap-guard', (): void => {
  it('is registered as a problem and enabled in the default Effect config', (): void => {
    const rule = registeredRule();

    expect(rule.meta?.type).toBe('problem');
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each([
    'const value = 1;',
    'succeed fail ? =>',
    'flatMap fail ? =>',
    'flatMap succeed ? =>',
    'flatMap succeed fail =>',
    'flatMap succeed fail ?',
  ])('keeps only the cheap Program visitor for source %j', (source): void => {
    expect(visitorKeysFor(source)).toStrictEqual(['Program']);
  });

  it('enables call analysis when every candidate token occurs from offset zero', (): void => {
    expect(visitorKeysFor('flatMap succeed fail ? =>')).toStrictEqual([
      'CallExpression',
      'Program',
    ]);
  });

  it.each([
    ['a data-first v3/v4 guard', guard('value.score >= 10')],
    [
      'a pipeable v3/v4 guard',
      imported(
        'source.pipe(Effect.flatMap(value => value.kind === "Expected" ? Effect.succeed(value) : Effect.fail(new Rejected())));',
      ),
    ],
    [
      'a standalone pipeable v3/v4 operator',
      imported(
        'const requireReady = Effect.flatMap(value => "id" in value ? Effect.succeed(value) : Effect.fail(new Rejected()));',
      ),
    ],
    [
      'a sole-return arrow block',
      flatMap(
        'value => { return "id" in value ? Effect.succeed(value) : Effect.fail(new Rejected()); }',
      ),
    ],
  ])('reports the exact diagnostic for %s', (_name, source): void => {
    const reports = reportsFor(source);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe(EXPECTED_MESSAGE);
  });

  it.each([
    ['strict equality on a discriminant', guard('value._tag === "Ready"')],
    ['reverse strict equality', guard('"Ready" === value._tag')],
    ['strict inequality against null', guard('value.deletedAt !== null')],
    ['less than', guard('value.rank < 10')],
    ['reverse less than or equal', guard('10 <= value.rank')],
    ['greater than', guard('value.rank > 0')],
    ['greater than or equal bigint', guard('value.rank >= 1n')],
    ['in', guard('"id" in value')],
    ['a typeof discriminant', guard('typeof value === "string"')],
    ['a typeof inequality', guard('typeof value.kind !== "number"')],
  ])('recognizes the cross-version-safe binary predicate %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it.each([
    [
      'a root Effect alias',
      'import { Effect as Fx } from "effect"; Fx.flatMap(source, value => value.ready === true ? Fx.succeed(value) : Fx.fail(new Rejected()));',
    ],
    [
      'an Effect subpath namespace',
      'import * as Fx from "effect/Effect"; source.pipe(Fx.flatMap(value => value.ready === true ? Fx.succeed(value) : Fx.fail(new Rejected())));',
    ],
    [
      'aliased named subpath imports',
      'import { flatMap as chain, succeed as pure, fail as reject } from "effect/Effect"; chain(source, value => value.ready === true ? pure(value) : reject(new Rejected()));',
    ],
    [
      'aliased named imports in pipeable form',
      'import { flatMap as chain, succeed as pure, fail as reject } from "effect/Effect"; source.pipe(chain(value => value.ready === true ? pure(value) : reject(new Rejected())));',
    ],
    [
      'a root package namespace',
      'import * as EffectPackage from "effect"; EffectPackage.Effect.flatMap(source, value => value.ready === true ? EffectPackage.Effect.succeed(value) : EffectPackage.Effect.fail(new Rejected()));',
    ],
  ])('recognizes %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it.each([
    ['an outer identifier in the error', failingGuard(READY, 'new Rejected(input.kind)')],
    ['an outer member call in the error', failingGuard(READY, 'errors.rejected(input)')],
    ['a longer identifier containing the callback name', failingGuard(READY, 'candidateValue')],
  ])('allows %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports every independent occurrence', (): void => {
    const source =
      imported(
        'Effect.flatMap(first, value => value.ready === true ? Effect.succeed(value) : Effect.fail(new FirstRejected())); ',
      ) +
      'Effect.flatMap(second, item => item.valid !== false ? Effect.succeed(item) : Effect.fail(new SecondRejected()));';

    expect(reportsFor(source)).toHaveLength(2);
  });

  it('publishes the exact diagnostic without an automatic fix', (): void => {
    const [report] = reportsFor(guard('value.ready === true'));

    expect(report?.message).toBe(EXPECTED_MESSAGE);
    expect(Reflect.get(report ?? {}, 'fix')).toBeUndefined();
  });

  it('reports the outer flatMap callee as the diagnostic location', (): void => {
    const source = guard('value.ready === true');
    const [report] = reportsFor(source);
    const node = report?.node as { end?: number; start?: number; type?: string } | undefined;

    expect(node?.type).toBe('MemberExpression');
    expect(source.slice(node?.start, node?.end)).toBe('Effect.flatMap');
  });

  it.each([
    ['the callback identifier directly', failingGuard(READY, 'value')],
    ['the callback identifier in a nested call', failingGuard(READY, 'new Rejected(value)')],
    ['a callback member', failingGuard(READY, 'value.error')],
    ['the callback identifier in a template', failingGuard(READY, '`invalid ${value}`')],
    ['the callback identifier in an inner arrow', failingGuard(READY, 'makeError(() => value)')],
    ['a shadowed callback identifier', failingGuard(READY, 'makeError(value => value.reason)')],
    ['a property key matching the callback identifier', failingGuard(READY, '{ value: outer }')],
  ])('preserves flatMap when the error expression contains %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['a different success identifier', guard('value.ready === true', 'Effect.succeed(other)')],
    [
      'a transformed success value',
      guard('value.ready === true', 'Effect.succeed(normalize(value))'),
    ],
    [
      'reversed success and failure branches',
      guard('value.ready === true', 'Effect.fail(new Rejected())', 'Effect.succeed(value)'),
    ],
  ])('preserves flatMap for %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['a boolean literal', guard('true')],
    ['a bare identifier', guard('value')],
    [
      'an outer narrowed error binding',
      imported(
        'declare let failure: Rejected | undefined; Effect.flatMap(source, value => failure === undefined ? ' +
          'Effect.succeed(value) : Effect.fail(failure));',
      ),
    ],
    ['a supported binary predicate without the callback binding', guard('flag === true')],
    [
      'a predicate identifier shared with the error expression',
      failingGuard('value.reason === state.current', 'state.current'),
    ],
    ['instanceof', guard('value instanceof Ready')],
    ['a nonliteral in key', guard('key in value')],
    ['typeof an outer identifier', guard('typeof other === "string"')],
    ['a mutable outer comparison', guard('value.version === state.currentVersion')],
    ['a double-negated operand', guard('(!!value) === true')],
    ['a call operand', guard('isString(value) === true')],
    ['a logical operand', guard('(typeof value === "string" && value.length > 0) === true')],
    ['a conditional operand', guard('(value.ready ? true : false) === true')],
    ['an optional member operand', guard('value?.ready === true')],
    ['a computed member operand', guard('value["ready"] === true')],
    ['a bare member', guard('value.ready')],
    ['an asserted expression', guard('(value.ready as boolean)')],
    ['unary not', guard('!value.disabled')],
    ['a mixed logical conjunction', guard('value.ready && value.enabled === true')],
    ['a boolean logical conjunction', guard('value.ready === true && value.enabled === true')],
    ['a nullish logical expression', guard('(value.ready ?? fallback)')],
    ['loose equality', guard('value.ready == true')],
    ['loose inequality', guard('value.ready != false')],
  ])('preserves an unsafe narrowing predicate for %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['a zero-parameter callback', flatMap(arrowGuard('', 'condition === true'))],
    ['a two-parameter callback', flatMap(arrowGuard('value, index', 'index >= 0'))],
    ['a default parameter', flatMap(arrowGuard('value = fallback'))],
    ['a rest parameter', flatMap(arrowGuard('...value'))],
    ['an object-destructured parameter', flatMap(arrowGuard('{ value }'))],
    ['an array-destructured parameter', flatMap(arrowGuard('[value]'))],
    ['a classic function', flatMap(functionGuard('function (value)'))],
    ['an async arrow', flatMap(`async ${arrowGuard('value')}`)],
    ['a generator function', flatMap(functionGuard('function* (value)'))],
    ['a generic arrow', flatMap(`<Value>${arrowGuard('value: Value', 'value === value')}`)],
    [
      'an explicit return annotation',
      flatMap(
        '(value): Effect.Effect<Value, Rejected> => value.ready === true ? Effect.succeed(value) : Effect.fail(new Rejected())',
      ),
    ],
  ])('preserves %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a declaration before return',
      blockGuard(`const ready = ${READY};`, `return ready ? ${SUCCESS} : ${FAILURE};`),
    ],
    ['a statement after return', blockGuard(`return ${BRANCHES};`, 'cleanup();')],
    ['an if statement', blockGuard(`if (${READY}) return ${SUCCESS};`, `return ${FAILURE};`)],
    [
      'a suspended conditional',
      flatMap(
        'value => Effect.suspend(() => value.ready === true ? Effect.succeed(value) : Effect.fail(new Rejected()))',
      ),
    ],
    [
      'a chained success branch',
      guard('value.ready === true', 'Effect.succeed(value).pipe(Effect.tap(audit))'),
    ],
    ['a local succeed constructor', guard('value.ready === true', 'LocalEffect.succeed(value)')],
    [
      'a local fail constructor',
      guard('value.ready === true', undefined, 'LocalEffect.fail(new Rejected())'),
    ],
  ])('preserves callback shape for %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['flatMap with no arguments', effectCall('Effect.flatMap', '')],
    ['flatMap with only its source', effectCall('Effect.flatMap', 'source')],
    [
      'flatMap with three arguments',
      effectCall('Effect.flatMap', `source, value => ${BRANCHES}, options`),
    ],
    [
      'pipeable flatMap with two arguments',
      imported(`source.pipe(Effect.flatMap(value => ${BRANCHES}, options));`),
    ],
    ['a spread-only flatMap', effectCall('Effect.flatMap', `...[source, value => ${BRANCHES}]`)],
    ['a spread callback', effectCall('Effect.flatMap', `source, ...[value => ${BRANCHES}]`)],
    [
      'type arguments on flatMap',
      effectCall('Effect.flatMap<Value, Rejected, never, Value>', `source, value => ${BRANCHES}`),
    ],
    [
      'a computed string flatMap access',
      effectCall('Effect["flatMap"]', `source, value => ${BRANCHES}`),
    ],
    [
      'a computed identifier flatMap access',
      effectCall('Effect[flatMap]', `source, value => ${BRANCHES}`),
    ],
    ['an optional flatMap access', effectCall('Effect?.flatMap', `source, value => ${BRANCHES}`)],
    ['an optional flatMap call', effectCall('Effect.flatMap?.', `source, value => ${BRANCHES}`)],
  ])('leaves %s outside the exact outer-call matcher', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['succeed with no arguments', guard('value.ready === true', 'Effect.succeed()')],
    ['succeed with two arguments', guard('value.ready === true', 'Effect.succeed(value, other)')],
    ['a spread succeed argument', guard('value.ready === true', 'Effect.succeed(...[value])')],
    ['type arguments on succeed', guard('value.ready === true', 'Effect.succeed<Value>(value)')],
    ['a computed succeed access', guard('value.ready === true', 'Effect["succeed"](value)')],
    ['an optional succeed access', guard('value.ready === true', 'Effect?.succeed(value)')],
    ['an optional succeed call', guard('value.ready === true', 'Effect.succeed?.(value)')],
    ['fail with no arguments', guard('value.ready === true', undefined, 'Effect.fail()')],
    [
      'fail with two arguments',
      guard('value.ready === true', undefined, 'Effect.fail(new Rejected(), other)'),
    ],
    [
      'a spread fail argument',
      guard('value.ready === true', undefined, 'Effect.fail(...[new Rejected()])'),
    ],
    [
      'type arguments on fail',
      guard('value.ready === true', undefined, 'Effect.fail<Rejected>(new Rejected())'),
    ],
    [
      'a computed fail access',
      guard('value.ready === true', undefined, 'Effect["fail"](new Rejected())'),
    ],
    [
      'an optional fail access',
      guard('value.ready === true', undefined, 'Effect?.fail(new Rejected())'),
    ],
    [
      'an optional fail call',
      guard('value.ready === true', undefined, 'Effect.fail?.(new Rejected())'),
    ],
  ])('leaves %s outside the exact branch-call matcher', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['no Effect import', directGuard()],
    ['an unrelated root import', directGuard('import { Effect } from "local-effect"')],
    ['a type-only root import', directGuard('import type { Effect } from "effect"')],
    ['a type-only root specifier', directGuard('import { type Effect } from "effect"')],
    [
      'a type-only subpath namespace',
      'import type * as Fx from "effect/Effect"; Fx.flatMap(source, value => value.ready === true ? Fx.succeed(value) : Fx.fail(new Rejected()));',
    ],
    [
      'type-only named subpath imports',
      'import { type flatMap, type succeed, type fail } from "effect/Effect"; flatMap(source, value => value.ready === true ? succeed(value) : fail(new Rejected()));',
    ],
    [
      'a different root export aliased as Effect',
      directGuard('import { Chunk as Effect } from "effect"'),
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'the root Effect binding',
      imported(
        'const run = (Effect: LocalEffect) => Effect.flatMap(source, value => value.ready === true ? Effect.succeed(value) : Effect.fail(new Rejected()));',
      ),
    ],
    ['the named flatMap binding', namedShadow('flatMap', 'LocalFlatMap')],
    ['the named succeed binding', namedShadow('succeed', 'LocalSucceed')],
    ['the named fail binding', namedShadow('fail', 'LocalFail')],
    [
      'the root package namespace binding',
      'import * as EffectPackage from "effect"; const run = (EffectPackage: LocalEffect) => EffectPackage.Effect.flatMap(source, value => value.ready === true ? EffectPackage.Effect.succeed(value) : EffectPackage.Effect.fail(new Rejected()));',
    ],
    [
      'a function-hoisted named binding',
      'import { flatMap, succeed, fail } from "effect/Effect"; function run() { var flatMap = LocalEffect.flatMap; return flatMap(source, value => value.ready === true ? succeed(value) : fail(new Rejected())); }',
    ],
  ])('respects lexical shadowing of %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a callback identifier',
      imported(
        'Effect.flatMap(source, validate); const unrelated = value => value ? Effect.succeed(value) : Effect.fail(new Rejected());',
      ),
    ],
    [
      'an unrelated flatMap call',
      imported(
        'LocalEffect.flatMap(source, value => value.ready === true ? Effect.succeed(value) : Effect.fail(new Rejected()));',
      ),
    ],
    [
      'a flatMap property read',
      imported(
        'const operation = Effect.flatMap; const validate = value => value.ready === true ? Effect.succeed(value) : Effect.fail(new Rejected());',
      ),
    ],
    [
      'a NewExpression lookalike',
      imported(
        'new Effect.flatMap(source, value => value.ready === true ? Effect.succeed(value) : Effect.fail(new Rejected()));',
      ),
    ],
    [
      'canonical data-first filterOrFail',
      imported('Effect.filterOrFail(source, value => value.ready === true, () => new Rejected());'),
    ],
    [
      'canonical pipeable filterOrFail',
      imported(
        'source.pipe(Effect.filterOrFail(value => value.ready === true, () => new Rejected()));',
      ),
    ],
  ])('accepts %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it('does not overlap equivalent map, tap, or andThen rules', (): void => {
    const equivalentRules = new Set([
      RULE_NAME,
      'effect-prefer-map-over-flatMap-succeed',
      'effect-prefer-tap-over-flatMap-as',
      'effect-prefer-andThen-over-flatMap-discarded-value',
    ]);
    const reports = runAllRules(guard('value.ready === true'))
      .map((report) => report.ruleName)
      .filter((ruleName): ruleName is string => Boolean(ruleName && equivalentRules.has(ruleName)));

    expect(reports).toStrictEqual([RULE_NAME]);
  });
});
