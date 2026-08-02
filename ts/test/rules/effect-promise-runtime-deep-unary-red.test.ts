import { describe, expect, it } from 'vitest';
import { runRule } from './effect-rule-test-utils';

const ruleName = 'effect-no-sync-for-promise';
const unaryDepth = 2048;
const deepUnary = '!'.repeat(unaryDepth);
const source = [
  'import { Effect } from "effect";',
  'const task = Effect.sync(() => Promise.resolve(1));',
  `if (${deepUnary}true) { Effect.runSync(task); }`,
].join('\n');

describe('effect-no-sync-for-promise deep unary runtime control', (): void => {
  it('reports the task in a shallow if control without overflowing', (): void => {
    expect(runRule(ruleName, source)).toHaveLength(1);
  });
});
