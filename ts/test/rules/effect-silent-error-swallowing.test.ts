import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

const rule = 'effect-no-silent-error-swallowing';

describe('effect-no-silent-error-swallowing', () => {
  it.each([
    ['Effect 4 catch to void', 'program.pipe(Effect.catch(() => Effect.void));'],
    [
      'Effect 3 catchAll to succeed(undefined)',
      'program.pipe(Effect.catchAll(() => Effect.succeed(undefined)));',
    ],
    ['Effect 4 catchCause to void', 'program.pipe(Effect.catchCause(() => Effect.void));'],
    ['Effect 3 catchAllCause to void', 'program.pipe(Effect.catchAllCause(() => Effect.void));'],
    ['data-first catch', 'const quiet = Effect.catch(program, () => Effect.void);'],
    ['block-bodied handler', 'program.pipe(Effect.catch((error) => { return Effect.void; }));'],
    ['Effect.ignore call', 'const ignored = Effect.ignore(program);'],
    [
      'aliased import',
      'import { Effect as E } from "effect";\nprogram.pipe(E.catch(() => E.void));',
    ],
  ])('reports %s', (_name, source) => {
    expect(runRule(rule, source)).toHaveLength(1);
  });

  it.each([
    [
      'logging and re-failing',
      'program.pipe(Effect.catch((error) => Effect.logError(error).pipe(Effect.andThen(Effect.fail(error)))));',
    ],
    ['targeted catchTag recovery', 'program.pipe(Effect.catchTag("NotFound", () => Effect.void));'],
    [
      'Effect 3 tag discriminator form',
      'program.pipe(Effect.catch("_tag", { failure: "NotFound", onFailure: () => Effect.void }));',
    ],
    [
      'a typed replacement value',
      'program.pipe(Effect.catch(() => Effect.succeed(fallbackUser)));',
    ],
    [
      'an explicit optional fallback, whose policy is decided separately',
      'program.pipe(Effect.orElseSucceed(() => undefined));',
    ],
    ['catch text inside a string', 'const docs = "Effect.catch(() => Effect.void)";'],
    [
      'a later unrelated undefined in the same file',
      'program.pipe(Effect.catchAll((error) => Effect.fail(new Wrapped({ cause: error }))));\nconst nothing = undefined;',
    ],
    [
      'a local function named catch',
      'const handlers = { catch: (f) => f }; handlers.catch(() => undefined);',
    ],
  ])('allows %s', (_name, source) => {
    expect(runRule(rule, source)).toHaveLength(0);
  });
});
