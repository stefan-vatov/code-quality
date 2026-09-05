import { describe, expect, it } from 'vitest';
import { RuleTester } from 'oxlint/plugins-dev';
import type { Rule } from '@oxlint/plugins';
import { benchmarkNativeRule } from '../../bench/performance-native-harness';
import { nativeRuleFixtures } from '../../bench/performance-native-fixtures';
import plugin from '../../src/rules/plugin';

describe('native benchmark host', () => {
  it.each([
    ['no-reflect-get', 'Reflect.get(owner, key);', 1],
    ['no-reflect-get', 'const Reflect = { get() {} }; Reflect.get();', 0],
    ['no-reflect-get', 'function read(Reflect: Reader) { Reflect.get(); }', 0],
    ['require-safety-comment-for-type-assertion', 'const value = input as User;', 1],
    [
      'require-safety-comment-for-type-assertion',
      '// SAFETY: the caller checked the user.\nexport const value = input as User;',
      0,
    ],
    [
      'no-widen-then-assert',
      'const source = { id: 1 }; const widened: unknown = source; const value = widened as User;',
      1,
    ],
    ['no-service-constructor-imports', 'import { makeUserService } from "./user";', 1],
  ] as const)('executes %s with native services: %s', (name, source, reports) => {
    const result = benchmarkNativeRule(
      name,
      plugin.rules[name],
      [{ filename: 'src/domain/bench.ts', source }],
      { iterations: 1, warmups: 0, cold: true },
    );
    expect(result.reports).toBe(reports);
    expect(result.row).toMatchObject({ inputSamples: 1, iterations: 1, operationsPerSample: 1 });
    expect(result.row.medianNs).toBeGreaterThan(0);
  });

  it('exercises a reporting candidate for every native rule in both phases', () => {
    const rules = Object.entries(plugin.rules).filter(([name]) => !name.startsWith('effect-'));
    expect(rules).toHaveLength(16);
    expect(nativeRuleFixtures).toHaveLength(7);
    for (const [name, rule] of rules) {
      for (const cold of [true, false]) {
        const result = benchmarkNativeRule(name, rule, nativeRuleFixtures, {
          iterations: 20,
          warmups: cold ? 0 : 10,
          cold,
        });
        expect(result.reports, `${name}/${cold ? 'cold' : 'hot'}`).toBeGreaterThan(0);
        expect(result.row).toMatchObject({
          inputSamples: 7,
          iterations: 20,
          operationsPerSample: 1,
        });
      }
    }
  });

  it('runs createOnce, before, enter/exit visitors and after on each timed traversal', () => {
    const events: string[] = [];
    const rule: Rule = {
      createOnce() {
        events.push('createOnce');
        return {
          before() {
            events.push('before');
          },
          Program() {
            events.push('enter');
          },
          'Program:exit'() {
            events.push('exit');
          },
          after() {
            events.push('after');
          },
        };
      },
    };
    benchmarkNativeRule('lifecycle', rule, [{ filename: 'bench.ts', source: 'const value = 1;' }], {
      iterations: 2,
      warmups: 1,
      cold: false,
    });
    expect(events).toEqual([
      'createOnce',
      'before',
      'enter',
      'exit',
      'after',
      'before',
      'enter',
      'exit',
      'after',
      'before',
      'enter',
      'exit',
      'after',
    ]);
  });

  it('propagates visitor errors and restores RuleTester scheduling', () => {
    const scheduling = { describe: RuleTester.describe, it: RuleTester.it };
    const rule: Rule = {
      createOnce() {
        return {
          Program() {
            throw new Error('native benchmark failure');
          },
        };
      },
    };
    expect(() =>
      benchmarkNativeRule('failure', rule, nativeRuleFixtures, {
        iterations: 1,
        warmups: 0,
        cold: true,
      }),
    ).toThrow('native benchmark failure');
    expect(RuleTester.describe).toBe(scheduling.describe);
    expect(RuleTester.it).toBe(scheduling.it);
  });
});
