import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expectedRuleCounts as counts } from '../scripts/rule-counts.mjs';
import localFactory from '../ts/src/index';

const normalizedText = (path: string): string =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replaceAll(/\s+/gu, ' ');

const ruleNames = (options: Parameters<typeof localFactory>[0]): string[] =>
  Object.keys(localFactory(options).rules ?? {});

describe('rule count source of truth', () => {
  it('matches the local factory in every mode', () => {
    expect(ruleNames({})).toHaveLength(counts.syntaxOnly);
    expect(ruleNames({ typeAware: true })).toHaveLength(counts.typeAware);
    expect(ruleNames({ effect: true })).toHaveLength(counts.syntaxOnlyWithEffect);
    expect(ruleNames({ effect: true, typeAware: true })).toHaveLength(counts.typeAwareWithEffect);
    expect(
      ruleNames({ effect: true, typeAware: true }).filter(
        (name) => !name.startsWith('thethracian/'),
      ),
    ).toHaveLength(counts.native);
    expect(ruleNames({}).filter((name) => name.startsWith('thethracian/'))).toHaveLength(
      counts.packageBase,
    );
  });
});

describe('rule counts in documentation', () => {
  it.each([
    [
      'ts/README.md',
      [
        `selects ${counts.syntaxOnly} reviewed rules: ${counts.nativeSyntaxOnly} syntax-only upstream Oxlint rules and ${counts.packageBase}`,
        `enables these ${counts.packageBase} rules as errors`,
        `for ${counts.typeAware} selected errors in total (${counts.native} native upstream errors plus the ${counts.packageBase} package-local rules)`,
        `enables ${counts.typeAware} errors (${counts.native} native plus ${counts.packageBase} package-local), or ${counts.typeAwareWithEffect} with`,
        `the totals are ${counts.syntaxOnly} and ${counts.syntaxOnlyWithEffect} respectively`,
        `| TypeScript safety | ${counts.packageBase} package-local errors`,
      ],
    ],
    [
      'README.md',
      [
        `Upstream Oxlint allowlist, ${counts.packageBase} TypeScript safety rules`,
        `enables ${counts.packageBase} package-local TypeScript safety rules`,
        `Local lint enables ${counts.typeAwareWithEffect} errors across ${counts.native} native rules, ${counts.packageBase} base package rules`,
        `The base preset enables ${counts.typeAware} errors with`,
        `totals are ${counts.syntaxOnly} without Effect and ${counts.syntaxOnlyWithEffect} with it`,
      ],
    ],
    [
      'AGENTS.md',
      [
        `plugin enables ${counts.packageBase} TypeScript safety rules`,
        `The local factory enables ${counts.typeAwareWithEffect} errors: ${counts.native} reviewed native rules, ${counts.packageBase} base package rules`,
        `repository lint runs ${counts.repository} with the plugin`,
        `enables ${counts.typeAware} errors; syntax-only totals are ${counts.syntaxOnly} without Effect and ${counts.syntaxOnlyWithEffect} with Effect`,
      ],
    ],
  ] as const)('%s states the current rule counts', (path, sentences) => {
    const text = normalizedText(path);
    for (const sentence of sentences) {
      expect(text.includes(sentence), `${path} must state: ${sentence}`).toBe(true);
    }
  });
});
