import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { hasSyncForPromiseSource } from '../../src/rules/effect-sync-promise-source';
import { readFileSync } from 'node:fs';

const scopeIndexSourcePath = fileURLToPath(
  new URL('../../src/rules/effect-sync-promise-scope-index.ts', import.meta.url),
);
const scopeIndexSource = readFileSync(scopeIndexSourcePath, 'utf8');
const pairAndArrow = '(0),Promise=>0,';
const reverseParameterScanPattern =
  /for\s*\(\s*let index = lastParenthesisBefore\(parentheses,\s*arrowIndex\);\s*index >= 0;\s*index -= 1\s*\)/;

const makeAdversarialSource = (count: number): string =>
  `const callbacks = [${pairAndArrow.repeat(count)}0];Effect.sync(() => Promise.resolve(1));`;

describe('Effect sync Promise parameter-scope construction scaling', (): void => {
  it('preserves global and parameter-bound Promise semantics', (): void => {
    const globalSource = makeAdversarialSource(8);
    const localSource =
      'const task = Effect.sync(() => (Promise => Promise.resolve(1))(localPromise));';

    expect(hasSyncForPromiseSource(globalSource)).toBe(true);
    expect(hasSyncForPromiseSource(localSource)).toBe(false);
  });

  it('uses indexed parameter matching instead of scanning prior parenthesis pairs', (): void => {
    expect(reverseParameterScanPattern.test(scopeIndexSource)).toBe(false);
  });
});
