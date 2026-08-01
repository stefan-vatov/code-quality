import { describe, expect, it } from 'vitest';
import type { SourceRule } from '../../src/rules/effect-rule-core';
import plugin from '../../src/rules/plugin';
import { runRule } from './effect-rule-test-utils';
import theThracianOxlint from '../../src/index';

const RULE_NAME = 'effect-prefer-catchIf-over-conditional-catch';
const EXPECTED_MESSAGE =
  'Use Effect.catchIf for predicate-based recovery instead of catching every typed error and re-failing the nonmatching branch.\n' +
  "Fix: Move the condition into Effect.catchIf's predicate and keep only the recovery callback; negate the predicate when the fail branch comes first.\n" +
  'Example:\n```ts\nimport { Effect } from "effect"\n\n' +
  'program.pipe(\n  Effect.catchIf(isRecoverable, (error) => recover(error))\n)\n```';

const RECOVER_FIRST = 'isRecoverable(error) ? recover(error) : Effect.fail(error)';
const FAIL_FIRST = 'isFatal(error) ? Effect.fail(error) : recover(error)';
const imported = (statement: string): string => `import { Effect } from "effect"; ${statement}`;
const arrow = (branches = RECOVER_FIRST): string => `error => ${branches}`;
const dataFirst = (api: 'catch' | 'catchAll', callback = arrow()): string =>
  imported(`Effect.${api}(program, ${callback});`);
const pipeable = (api: 'catch' | 'catchAll', callback = arrow()): string =>
  imported(`program.pipe(Effect.${api}(${callback}));`);
const withFailure = (failure: string): string =>
  dataFirst('catchAll', arrow(`isRecoverable(error) ? recover(error) : ${failure}`));
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

describe('effect-prefer-catchIf-over-conditional-catch', (): void => {
  it('is registered as a problem and enabled in the default Effect config', (): void => {
    const rule = registeredRule();

    expect(rule.meta?.type).toBe('problem');
    expect(theThracianOxlint().rules).toHaveProperty(`thethracian/${RULE_NAME}`, 'error');
  });

  it.each([
    'catch fail ? =>',
    'effect fail ? =>',
    'effect catch ? =>',
    'effect catch fail ?',
    'effect catch fail =>',
    'effect catch fail ? function',
  ])('keeps only the cheap Program visitor for source %j', (source): void => {
    expect(visitorKeysFor(source)).toStrictEqual(['Program']);
  });

  it('enables call analysis when every candidate token occurs from offset zero', (): void => {
    expect(visitorKeysFor('effect catch fail ? =>')).toStrictEqual(['CallExpression', 'Program']);
  });

  it.each([
    ['v3 data-first catchAll', dataFirst('catchAll')],
    ['v3 pipeable catchAll with the fail branch first', pipeable('catchAll', arrow(FAIL_FIRST))],
    ['v4 data-first catch', dataFirst('catch')],
    ['v4 pipeable catch', pipeable('catch', arrow(FAIL_FIRST))],
    [
      'a concise v4 HttpApiMiddleware-style arrow with an explicit return type',
      dataFirst(
        'catch',
        `(error): Effect.Effect<HttpApiMiddleware.Provides<Middleware>, HttpApiMiddleware.Error<Middleware>> => ${RECOVER_FIRST}`,
      ),
    ],
  ])('reports the exact diagnostic for %s', (_name, source): void => {
    const reports = reportsFor(source);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe(EXPECTED_MESSAGE);
  });

  it.each([
    [
      'a root Effect alias',
      'import { Effect as Fx } from "effect"; Fx.catchAll(program, error => isRecoverable(error) ? recover(error) : Fx.fail(error));',
    ],
    [
      'an effect/Effect namespace',
      'import * as Fx from "effect/Effect"; program.pipe(Fx.catch(error => isRecoverable(error) ? recover(error) : Fx.fail(error)));',
    ],
    [
      'aliased named effect/Effect imports',
      'import { catchAll as recoverAll, fail as reject } from "effect/Effect"; recoverAll(program, error => isRecoverable(error) ? recover(error) : reject(error));',
    ],
    [
      'an aliased named v4 catch import in pipeable form',
      'import { catch as recoverAll, fail as reject } from "effect/Effect"; program.pipe(recoverAll(error => isFatal(error) ? reject(error) : recover(error)));',
    ],
    [
      'a root package namespace Effect export',
      'import * as Root from "effect"; Root.Effect.catch(program, error => isRecoverable(error) ? recover(error) : Root.Effect.fail(error));',
    ],
  ])('recognizes %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(1);
  });

  it('reports every independent conditional catch', (): void => {
    const source = imported(
      `Effect.catchAll(first, ${arrow()}); Effect.catch(second, issue => shouldRetry(issue) ? retry(issue) : Effect.fail(issue));`,
    );

    expect(reportsFor(source)).toHaveLength(2);
  });

  it('publishes the exact diagnostic without an automatic fix', (): void => {
    const [report] = reportsFor(dataFirst('catchAll'));

    expect(report?.message).toBe(EXPECTED_MESSAGE);
    expect(Reflect.get(report ?? {}, 'fix')).toBeUndefined();
  });

  it.each([
    ['Effect.catchAll', dataFirst('catchAll')],
    ['Effect.catch', dataFirst('catch')],
  ])('reports the outer %s callee as the diagnostic location', (expected, source): void => {
    const [report] = reportsFor(source);
    const node = report?.node as { end?: number; start?: number; type?: string } | undefined;

    expect(node?.type).toBe('MemberExpression');
    expect(source.slice(node?.start, node?.end)).toBe(expected);
  });

  it.each([
    ['a zero-parameter arrow', dataFirst('catchAll', `() => ${RECOVER_FIRST}`)],
    ['a multiple-parameter arrow', dataFirst('catch', `(error, index) => ${RECOVER_FIRST}`)],
    ['a default parameter', dataFirst('catchAll', `(error = fallback) => ${RECOVER_FIRST}`)],
    ['a rest parameter', dataFirst('catch', `(...error) => ${RECOVER_FIRST}`)],
    ['an object-destructured parameter', dataFirst('catchAll', `({ error }) => ${RECOVER_FIRST}`)],
    ['an array-destructured parameter', dataFirst('catch', `([error]) => ${RECOVER_FIRST}`)],
    ['an async arrow', dataFirst('catchAll', `async error => ${RECOVER_FIRST}`)],
    [
      'an async anonymous function',
      dataFirst('catch', `async function (error) { return ${RECOVER_FIRST}; }`),
    ],
    [
      'a generator function',
      dataFirst('catchAll', `function* (error) { return ${RECOVER_FIRST}; }`),
    ],
    [
      'a named function',
      dataFirst('catch', `function recoverConditionally(error) { return ${RECOVER_FIRST}; }`),
    ],
  ])('preserves catch behavior for %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['a sole-return arrow block', dataFirst('catchAll', `error => { return ${RECOVER_FIRST}; }`)],
    [
      'an anonymous function with exactly one return',
      pipeable('catch', `function (error) { return ${FAIL_FIRST}; }`),
    ],
    [
      'a declaration before the return',
      dataFirst(
        'catchAll',
        `error => { const retry = isRecoverable(error); return retry ? recover(error) : Effect.fail(error); }`,
      ),
    ],
    [
      'a statement after the return',
      dataFirst('catch', `error => { return ${RECOVER_FIRST}; cleanup(); }`),
    ],
    [
      'if-based control flow',
      dataFirst(
        'catchAll',
        'error => { if (isRecoverable(error)) return recover(error); return Effect.fail(error); }',
      ),
    ],
    ['an empty block', dataFirst('catch', 'error => {}')],
    [
      'a suspended conditional',
      dataFirst('catchAll', `error => Effect.suspend(() => ${RECOVER_FIRST})`),
    ],
    [
      'an asserted conditional expression',
      dataFirst('catch', `error => (${RECOVER_FIRST}) as RecoveryEffect`),
    ],
    [
      'a satisfies-wrapped conditional expression',
      dataFirst('catchAll', `error => (${RECOVER_FIRST}) satisfies RecoveryEffect`),
    ],
    [
      'an assertion-wrapped callback',
      imported(`Effect.catch(program, ((${arrow()}) as RecoveryHandler));`),
    ],
    ['a non-null-wrapped fail branch', withFailure('Effect.fail(error)!')],
  ])('leaves the callback wrapper or block shape unchanged for %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'the same re-fail in both branches',
      dataFirst('catchAll', arrow('isFatal(error) ? Effect.fail(error) : Effect.fail(error)')),
    ],
    [
      'no re-fail branch',
      dataFirst('catch', arrow('isRecoverable(error) ? recover(error) : fallback(error)')),
    ],
    ['a re-fail of another identifier', withFailure('Effect.fail(otherError)')],
    ['a re-fail of a member', withFailure('Effect.fail(error.cause)')],
    ['a local fail constructor', withFailure('LocalEffect.fail(error)')],
  ])('preserves branch semantics for %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['catchAll with no arguments', imported('Effect.catchAll();')],
    ['catch with only a source', imported('Effect.catch(program);')],
    ['catchAll with three arguments', imported(`Effect.catchAll(program, ${arrow()}, options);`)],
    [
      'pipeable catch with two arguments',
      imported(`program.pipe(Effect.catch(${arrow()}, options));`),
    ],
    ['a spread-only catchAll call', imported(`Effect.catchAll(...[program, ${arrow()}]);`)],
    ['a spread catch handler', imported(`Effect.catch(program, ...[${arrow()}]);`)],
    [
      'type arguments on catchAll',
      imported(`Effect.catchAll<Failure, Recovery>(program, ${arrow()});`),
    ],
    ['a computed catchAll access', imported(`Effect["catchAll"](program, ${arrow()});`)],
    ['an optional catch access', imported(`Effect?.catch(program, ${arrow()});`)],
    ['an optional catchAll call', imported(`Effect.catchAll?.(program, ${arrow()});`)],
    ['a parenthesized catch callee', imported(`(Effect.catch)(program, ${arrow()});`)],
  ])('leaves %s outside the exact catch-call matcher', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    ['fail with no arguments', withFailure('Effect.fail()')],
    ['fail with two arguments', withFailure('Effect.fail(error, cause)')],
    ['a spread fail argument', withFailure('Effect.fail(...[error])')],
    ['type arguments on fail', withFailure('Effect.fail<Failure>(error)')],
    ['a computed fail access', withFailure('Effect["fail"](error)')],
    ['an optional fail access', withFailure('Effect?.fail(error)')],
    ['an optional fail call', withFailure('Effect.fail?.(error)')],
  ])('leaves %s outside the exact fail-call matcher', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'no Effect import',
      'Effect.catchAll(program, error => isRecoverable(error) ? recover(error) : Effect.fail(error));',
    ],
    [
      'an unrelated root import',
      'import { Effect } from "local-effect"; Effect.catch(program, error => isRecoverable(error) ? recover(error) : Effect.fail(error));',
    ],
    [
      'a type-only root import',
      'import type { Effect } from "effect"; Effect.catchAll(program, error => isRecoverable(error) ? recover(error) : Effect.fail(error));',
    ],
    [
      'a type-only root specifier',
      'import { type Effect } from "effect"; Effect.catch(program, error => isRecoverable(error) ? recover(error) : Effect.fail(error));',
    ],
    [
      'a type-only effect/Effect namespace',
      'import type * as Fx from "effect/Effect"; Fx.catchAll(program, error => isRecoverable(error) ? recover(error) : Fx.fail(error));',
    ],
    [
      'type-only named effect/Effect imports',
      'import { type catchAll, type fail } from "effect/Effect"; catchAll(program, error => isRecoverable(error) ? recover(error) : fail(error));',
    ],
    [
      'a different root export aliased as Effect',
      'import { Chunk as Effect } from "effect"; Effect.catch(program, error => isRecoverable(error) ? recover(error) : Effect.fail(error));',
    ],
    [
      'direct Root.catch and Root.fail calls',
      'import * as Root from "effect"; Root.catch(program, error => isRecoverable(error) ? recover(error) : Root.fail(error));',
    ],
    [
      'a genuine Root.Effect.catch with direct Root.fail',
      'import * as Root from "effect"; Root.Effect.catch(program, error => isRecoverable(error) ? recover(error) : Root.fail(error));',
    ],
  ])('ignores %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'the root Effect binding',
      imported(`const run = (Effect: LocalEffect) => Effect.catchAll(program, ${arrow()});`),
    ],
    [
      'the effect/Effect namespace binding',
      'import * as Fx from "effect/Effect"; const run = (Fx: LocalEffect) => Fx.catch(program, error => isRecoverable(error) ? recover(error) : Fx.fail(error));',
    ],
    [
      'the named catchAll binding',
      'import { catchAll as recoverAll, fail as reject } from "effect/Effect"; const run = (recoverAll: LocalCatch) => recoverAll(program, error => isRecoverable(error) ? recover(error) : reject(error));',
    ],
    [
      'the named fail binding',
      'import { catch as recoverAll, fail as reject } from "effect/Effect"; const run = (reject: LocalFail) => recoverAll(program, error => isRecoverable(error) ? recover(error) : reject(error));',
    ],
    [
      'the root package namespace binding',
      'import * as Root from "effect"; const run = (Root: LocalEffect) => Root.Effect.catch(program, error => isRecoverable(error) ? recover(error) : Root.Effect.fail(error));',
    ],
    [
      'a function-hoisted named catch binding',
      'import { catchAll as recoverAll, fail as reject } from "effect/Effect"; function run() { var recoverAll = LocalEffect.catchAll; return recoverAll(program, error => isRecoverable(error) ? recover(error) : reject(error)); }',
    ],
  ])('respects lexical shadowing of %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });

  it.each([
    [
      'a callback identifier',
      imported(`Effect.catchAll(program, handler); const handler = ${arrow()};`),
    ],
    ['an unrelated catch call', imported(`LocalEffect.catch(program, ${arrow()});`)],
    [
      'a catch property read',
      imported(`const operation = Effect.catchAll; const handler = ${arrow()};`),
    ],
    ['a NewExpression lookalike', imported(`new Effect.catchAll(program, ${arrow()});`)],
    [
      'canonical pipeable catchIf',
      imported('program.pipe(Effect.catchIf(isRecoverable, error => recover(error)));'),
    ],
    [
      'canonical data-first catchIf',
      imported('Effect.catchIf(program, isRecoverable, error => recover(error));'),
    ],
  ])('accepts %s', (_name, source): void => {
    expect(reportsFor(source)).toHaveLength(0);
  });
});
