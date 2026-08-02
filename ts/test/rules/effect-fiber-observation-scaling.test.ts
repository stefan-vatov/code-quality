import { describe, expect, it } from 'vitest';
import {
  hasRunForkWithoutObserver,
  hasUnobservedFork,
} from '../../src/rules/effect-default-fiber-helpers';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const fiberHelpersURL = new URL('../../src/rules/effect-default-fiber-helpers.ts', import.meta.url)
  .href;
const SAFE_FIXTURE_COUNT = 2_000;
const SCALING_SMALL_COUNT = 500;
const SCALING_LARGE_COUNT = 8_000;
const SCALING_MULTIPLIER = SCALING_LARGE_COUNT / SCALING_SMALL_COUNT;
const MAX_NORMALIZED_GROWTH = 3;
const SCALING_NOISE_FLOOR_MS = 100;
const CHILD_TIMEOUT_MS = 5_000;

interface ProbeMeasurement {
  elapsedMs: number;
  result: boolean;
}

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

const parseProbeMeasurement = (line: string): ProbeMeasurement => {
  const [resultText, elapsedText] = line.split(':');
  return {
    elapsedMs: Number(elapsedText),
    result: resultText === 'true',
  };
};

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

  it(
    'bounds safe fiber-observation scaling in a child process',
    { timeout: CHILD_TIMEOUT_MS + 2_000 },
    (): void => {
      const probeSource = `
        import {
          hasRunForkWithoutObserver,
          hasUnobservedFork,
        } from ${JSON.stringify(fiberHelpersURL)};
        const observedRunForkSource = (count) => [
          "function observeMany() {",
          ...Array.from({ length: count }, (_, index) =>
            "  const fiber" + String(index) + " = Effect.runFork(program" + String(index) + ");\\n" +
            "  fiber" + String(index) + ".addObserver(() => undefined);",
          ),
          "}",
        ].join("\\n");
        const joinedForkSource = (count) => [
          "const program = Effect.gen(function* () {",
          ...Array.from({ length: count }, (_, index) =>
            "  const fiber" + String(index) + " = yield* Effect.fork(worker" + String(index) + ");\\n" +
            "  yield* Fiber.join(fiber" + String(index) + ");",
          ),
          "});",
        ].join("\\n");
        const measure = (predicate, source) => {
          predicate(source);
          const startedAt = process.hrtime.bigint();
          const result = predicate(source);
          const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
          return String(result) + ":" + String(elapsedMs);
        };
        const smallCount = ${SCALING_SMALL_COUNT};
        const largeCount = ${SCALING_LARGE_COUNT};
        process.stdout.write([
          measure(hasRunForkWithoutObserver, observedRunForkSource(smallCount)),
          measure(hasRunForkWithoutObserver, observedRunForkSource(largeCount)),
          measure(hasUnobservedFork, joinedForkSource(smallCount)),
          measure(hasUnobservedFork, joinedForkSource(largeCount)),
        ].join("\\n"));
      `;
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '--eval', probeSource],
        {
          cwd: repositoryRoot,
          encoding: 'utf8',
          maxBuffer: 50_000,
          timeout: CHILD_TIMEOUT_MS,
        },
      );
      const diagnostics = [result.error?.message, result.stderr, result.stdout]
        .filter((value): value is string => Boolean(value))
        .join('\n');

      expect(result.status, diagnostics).toBe(0);

      const measurements = result.stdout.trim().split('\n').map(parseProbeMeasurement);
      expect(measurements).toHaveLength(4);
      const [smallRunFork, largeRunFork, smallUnobservedFork, largeUnobservedFork] = measurements;

      expect(smallRunFork?.result).toBe(false);
      expect(largeRunFork?.result).toBe(false);
      expect(smallUnobservedFork?.result).toBe(false);
      expect(largeUnobservedFork?.result).toBe(false);
      expect(largeRunFork?.elapsedMs).toBeLessThan(
        Math.max(
          smallRunFork?.elapsedMs ?? Number.POSITIVE_INFINITY,
          SCALING_NOISE_FLOOR_MS / SCALING_MULTIPLIER,
        ) *
          SCALING_MULTIPLIER *
          MAX_NORMALIZED_GROWTH,
      );
    },
  );
});
