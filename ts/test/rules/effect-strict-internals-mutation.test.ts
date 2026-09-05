import { describe, expect, it } from 'vitest';
import { hasRunSyncInServerRequestHandler } from '../../src/rules/effect-strict-internals';

describe('public Effect API boundaries', (): void => {
  const booleanCases = [
    [
      'server runSync',
      hasRunSyncInServerRequestHandler,
      'const handler = () => Effect.runSync(program);',
      'const handler = () => Effect.runPromise(program);',
      'const docs = "handler = () => Effect.runSync(program)";',
      'const handlerFactory = () => Effect.runSync(program);',
    ],
  ] as const;

  it.each(booleanCases)(
    '%s distinguishes code from boundaries',
    (_, check, violation, safe, concealed, near): void => {
      expect(check(violation)).toBe(true);
      expect(check(safe)).toBe(false);
      expect(check(concealed)).toBe(false);
      expect(check(`// ${violation}`)).toBe(false);
      expect(check(near)).toBe(false);
    },
  );

  it('detects both assignment and function server handler forms', (): void => {
    expect(hasRunSyncInServerRequestHandler('route = () => Effect.runSync(program);')).toBe(true);
    expect(
      hasRunSyncInServerRequestHandler(
        'function loader(request) { return Effect.runSync(program); }',
      ),
    ).toBe(true);
  });
});
