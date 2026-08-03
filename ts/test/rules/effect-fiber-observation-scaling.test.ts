import { describe, expect, it } from 'vitest';
import {
  hasRunForkWithoutObserver,
  hasUnobservedFork,
} from '../../src/rules/effect-default-fiber-helpers';
const SAFE_FIXTURE_COUNT = 2_000;

const observedRunForkSource = (count: number): string =>
  [
    'function observeMany(): void {',
    ...Array.from(
      { length: count },
      (_, index): string =>
        `  const fiber${index} = Effect.runFork(program${index});\n` +
        `  fiber${index}.addObserver(() => undefined);`,
    ),
    '}',
  ].join('\n');

const joinedForkSource = (count: number): string =>
  [
    'const program = Effect.gen(function* () {',
    ...Array.from(
      { length: count },
      (_, index): string =>
        `  const fiber${index} = yield* Effect.fork(worker${index});\n` +
        `  yield* Fiber.join(fiber${index});`,
    ),
    '});',
  ].join('\n');

const sameNameShadowSource = (): string =>
  [
    'function observeShadowed(): void {',
    '  {',
    '    const fiber = Effect.runFork(firstProgram);',
    '    fiber.addObserver(() => undefined);',
    '  }',
    '  {',
    '    const fiber = Effect.runFork(secondProgram);',
    '    fiber.addObserver(() => undefined);',
    '  }',
    '}',
  ].join('\n');

const reassignedRunForkSource = (): string =>
  [
    'function observeReassignment(): void {',
    '  let fiber = Effect.runFork(firstProgram);',
    '  fiber.addObserver(() => undefined);',
    '  fiber = Effect.runFork(secondProgram);',
    '}',
  ].join('\n');

const sameNameJoinedForkSource = (includeSecondObservation: boolean): string =>
  [
    'const program = Effect.gen(function* () {',
    '  {',
    '    const fiber = yield* Effect.fork(firstWorker);',
    '    yield* Fiber.join(fiber);',
    '  }',
    '  {',
    '    const fiber = yield* Effect.fork(secondWorker);',
    ...(includeSecondObservation ? ['    yield* Fiber.join(fiber);'] : []),
    '  }',
    '});',
  ].join('\n');

describe('Effect fiber-observation scanner scaling', (): void => {
  it('returns false for a large observed runFork fixture', (): void => {
    const source = observedRunForkSource(SAFE_FIXTURE_COUNT);

    expect(hasRunForkWithoutObserver(source)).toBe(false);
  });

  it('returns false for a large joined yielded-fork fixture', (): void => {
    const source = joinedForkSource(SAFE_FIXTURE_COUNT);

    expect(hasUnobservedFork(source)).toBe(false);
  });

  it('keeps same-name shadowing and reassignment observations separate', (): void => {
    const shadowedRunFork = sameNameShadowSource();
    const reassignedRunFork = reassignedRunForkSource();
    const joinedShadowedFork = sameNameJoinedForkSource(true);
    const floatingShadowedFork = sameNameJoinedForkSource(false);

    expect(hasRunForkWithoutObserver(shadowedRunFork)).toBe(false);
    expect(hasRunForkWithoutObserver(reassignedRunFork)).toBe(true);
    expect(hasUnobservedFork(joinedShadowedFork)).toBe(false);
    expect(hasUnobservedFork(floatingShadowedFork)).toBe(true);
  });
});
