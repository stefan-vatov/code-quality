import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import plugin from '../../src/rules/plugin.js';
import type { Report } from './effect-rule-test-utils.js';

const programNode = { type: 'Program', range: [0, 0] };

function runRuleWithContext(ruleName: string, context: object): Report[] {
  const reports: Report[] = [];
  const rule = plugin.rules[ruleName as keyof typeof plugin.rules];
  expect(rule, `${ruleName} must be registered`).toBeDefined();
  const visitors = rule.create({
    report(report: Report) {
      reports.push(report);
    },
    ...context,
  });

  visitors.Program?.(programNode);

  return reports;
}

describe('Effect rule source reading', () => {
  it('uses sourceCode.text before falling back to filesystem reads', () => {
    const reports = runRuleWithContext('effect-no-string-errors', {
      filename: '/does/not/exist.ts',
      sourceCode: {
        text: 'const failure = Effect.fail("bad");',
      },
    });

    expect(reports).toHaveLength(1);
  });

  it('prefers sourceCode.text over a readable but stale filename', () => {
    const root = mkdtempSync(join(tmpdir(), 'thx-effect-source-'));
    const filePath = join(root, 'stale.ts');
    writeFileSync(filePath, 'const failure = Effect.fail("bad");');

    try {
      const reports = runRuleWithContext('effect-no-string-errors', {
        filename: filePath,
        sourceCode: {
          text: 'const failure = Effect.fail(new TaggedError());',
        },
      });

      expect(reports).toHaveLength(0);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('uses sourceCode.getText when text is unavailable', () => {
    const reports = runRuleWithContext('effect-no-string-errors', {
      sourceCode: {
        getText: () => 'const failure = Effect.fail("bad");',
      },
    });

    expect(reports).toHaveLength(1);
  });

  it('uses sourceCode for helper-backed Effect rules', () => {
    const reports = runRuleWithContext('effect-no-sync-for-promise', {
      sourceCode: {
        text: 'const program = Effect.sync(() => fetch("/users"));',
      },
    });

    expect(reports).toHaveLength(1);
  });

  it('uses sourceCode with strict path rule options', () => {
    const reports = runRuleWithContext('effect-no-direct-process-env-outside-config-layer', {
      filename: 'src/domain/user.ts',
      options: [{ configLayers: ['settings/**'] }],
      sourceCode: {
        text: 'process.env.API_TOKEN;',
      },
    });

    expect(reports).toHaveLength(1);
  });

  it('combines sourceCode text with filename-based strict path decisions', () => {
    const options = [{ entrypoints: ['workers/main.ts'], configLayers: ['settings/**'] }];

    expect(
      runRuleWithContext('effect-no-run-outside-entrypoints', {
        filename: 'src/domain/user.ts',
        options,
        sourceCode: { text: 'Effect.runPromise(program);' },
      }),
    ).toHaveLength(1);
    expect(
      runRuleWithContext('effect-no-run-outside-entrypoints', {
        filename: 'workers/main.ts',
        options,
        sourceCode: { text: 'Effect.runPromise(program);' },
      }),
    ).toHaveLength(0);
    expect(
      runRuleWithContext('effect-schema-require-config-schema', {
        filename: 'settings/app.ts',
        options,
        sourceCode: { text: 'Config.string("API_TOKEN");' },
      }),
    ).toHaveLength(1);
  });

  it('does not report when no source is available', () => {
    const reports = runRuleWithContext('effect-no-string-errors', {});

    expect(reports).toHaveLength(0);
  });
});
