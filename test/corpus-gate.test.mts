import { describe, expect, it } from 'vitest';
import { compareToBaseline, countRuleHits, selectCorpusRules } from '../scripts/corpus-gate.mjs';

describe('corpus gate rule counting', () => {
  it('counts diagnostics per rule using slash-separated rule ids', () => {
    expect(
      countRuleHits([
        { code: 'thethracian(no-reflect-get)' },
        { code: 'thethracian(no-reflect-get)' },
        { code: 'unicorn(no-abusive-eslint-disable)' },
      ]),
    ).toStrictEqual({
      'thethracian/no-reflect-get': 2,
      'unicorn/no-abusive-eslint-disable': 1,
    });
  });

  it('groups diagnostics without a rule code under an explicit unnamed bucket', () => {
    expect(countRuleHits([{ message: 'Unused directive' }, { code: '' }])).toStrictEqual({
      '(unnamed)': 2,
    });
  });

  it('returns sorted keys so reports and baselines are stable', () => {
    expect(
      Object.keys(
        countRuleHits([{ code: 'thethracian(z-rule)' }, { code: 'thethracian(a-rule)' }]),
      ),
    ).toStrictEqual(['thethracian/a-rule', 'thethracian/z-rule']);
  });
});

describe('corpus gate rule selection', () => {
  it('keeps package rules and explicitly tracked native rules only', () => {
    expect(
      selectCorpusRules(
        {
          'no-debugger': 'error',
          'thethracian/no-reflect-get': 'error',
          'thethracian/no-runtime-typeof': ['error', { allowInTypeGuards: true }],
          'unicorn/no-abusive-eslint-disable': 'error',
        },
        ['unicorn/no-abusive-eslint-disable'],
      ),
    ).toStrictEqual({
      'thethracian/no-reflect-get': 'error',
      'thethracian/no-runtime-typeof': ['error', { allowInTypeGuards: true }],
      'unicorn/no-abusive-eslint-disable': 'error',
    });
  });
});

describe('corpus gate baseline comparison', () => {
  it('reports only changed counts, including new and vanished rules', () => {
    expect(
      compareToBaseline(
        { alchemy: { 'thethracian/a': 3, 'thethracian/gone': 1, 'thethracian/same': 2 } },
        { alchemy: { 'thethracian/a': 5, 'thethracian/new': 4, 'thethracian/same': 2 } },
      ),
    ).toStrictEqual([
      { baseline: 3, current: 5, delta: 2, repo: 'alchemy', rule: 'thethracian/a' },
      { baseline: 1, current: 0, delta: -1, repo: 'alchemy', rule: 'thethracian/gone' },
      { baseline: 0, current: 4, delta: 4, repo: 'alchemy', rule: 'thethracian/new' },
    ]);
  });

  it('treats a repository missing from the baseline as all-new counts', () => {
    expect(compareToBaseline({}, { effect: { 'thethracian/a': 1 } })).toStrictEqual([
      { baseline: 0, current: 1, delta: 1, repo: 'effect', rule: 'thethracian/a' },
    ]);
  });

  it('returns no rows when nothing changed', () => {
    expect(compareToBaseline({ r: { x: 1 } }, { r: { x: 1 } })).toStrictEqual([]);
  });
});
