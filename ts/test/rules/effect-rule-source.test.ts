import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getEffectRule, type Report } from './effect-rule-test-utils';
import type { Context } from '../../src/rules/effect-rule-core';

const programNode = { type: 'Program', range: [0, 0] };

function runRuleWithContext(ruleName: string, context: Omit<Context, 'report'>): Report[] {
  const reports: Report[] = [];
  const rule = getEffectRule(ruleName);
  expect(rule, `${ruleName} must be registered`).toBeDefined();
  const visitors = rule.create({
    report(report) {
      reports.push(report);
    },
    ...context,
  });

  visitors.Program?.(programNode);

  return reports;
}

describe('Effect rule source reading', () => {
  it('uses sourceCode.text before falling back to filesystem reads', () => {
    const reports = runRuleWithContext('effect-no-catchAll-with-mapError', {
      filename: '/does/not/exist.ts',
      sourceCode: {
        text: 'const recovered = program.pipe(Effect.catchAll(() => Effect.fail(error)));',
      },
    });

    expect(reports).toHaveLength(1);
  });

  it('prefers sourceCode.text over a readable but stale filename', () => {
    const root = mkdtempSync(join(tmpdir(), 'thx-effect-source-'));
    const filePath = join(root, 'stale.ts');
    writeFileSync(
      filePath,
      'const recovered = program.pipe(Effect.catchAll(() => Effect.fail(error)));',
    );

    try {
      const reports = runRuleWithContext('effect-no-catchAll-with-mapError', {
        filename: filePath,
        sourceCode: {
          text: 'const recovered = program.pipe(Effect.mapError(toError));',
        },
      });

      expect(reports).toHaveLength(0);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('uses sourceCode.getText when text is unavailable', () => {
    const reports = runRuleWithContext('effect-no-catchAll-with-mapError', {
      sourceCode: {
        getText: () => 'const recovered = program.pipe(Effect.catchAll(() => Effect.fail(error)));',
      },
    });

    expect(reports).toHaveLength(1);
  });

  it('uses sourceCode for helper-backed Effect rules', () => {
    const reports = runRuleWithContext('effect-no-runfork-without-observer', {
      sourceCode: {
        text: 'Effect.runFork(program);',
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
    const reports = runRuleWithContext('effect-no-catchAll-with-mapError', {});

    expect(reports).toHaveLength(0);
  });
});
