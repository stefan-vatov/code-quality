import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import plugin from '../src/rules/plugin';

const rootJSON = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf-8'));

const rootText = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf-8');

const repoRoot = new URL('../..', import.meta.url);

const objectKeys = (value: unknown): string[] => {
  if (!value || typeof value !== 'object') {
    return [];
  }
  return Object.keys(value);
};

describe('performance gate configuration', () => {
  it('tracks every custom Oxlint rule with an explicit performance budget', () => {
    const budgets = rootJSON('ts/bench/performance-budgets.json');
    const ruleBudgets = objectKeys((budgets as { rules?: unknown }).rules);

    expect(ruleBudgets.sort()).toStrictEqual(Object.keys(plugin.rules).sort());
  });

  it('tracks every shipped codemod transform with an explicit performance budget', () => {
    const budgets = rootJSON('ts/bench/performance-budgets.json');
    const codemodBudgets = objectKeys((budgets as { codemods?: unknown }).codemods);

    expect(codemodBudgets.sort()).toStrictEqual([
      'addInternalExportDocs',
      'addVoidReturnTypes',
      'applyCodemodFixToSource',
      'formatFileHeaderComment',
      'formatJSDocComments',
      'inlineLocalExportLists',
      'preferConciseArrowBodies',
      'preferExplicitBranches',
      'preferFunctionExpressions',
      'renameMisCasedAcronyms',
      'sortImportDeclarations',
    ]);
  });

  it('wires the performance gate into package scripts and pre-push checks', () => {
    const packageJSON = rootJSON('package.json') as { scripts?: Record<string, string> };
    const prePush = rootText('.husky/pre-push');
    const ciWorkflow = rootText('.github/workflows/ci.yml');
    const releaseWorkflow = rootText('.github/workflows/release.yml');

    expect(packageJSON.scripts?.['performance:gate']).toBe(
      'tsx ts/bench/performance-gate.ts --check',
    );
    expect(packageJSON.scripts?.['performance:calibrate']).toBe(
      'tsx ts/bench/performance-gate.ts --update --runs 20',
    );
    expect(prePush).toContain('pnpm run performance:gate');
    expect(ciWorkflow).toContain('run: pnpm run performance:gate');
    expect(releaseWorkflow).toContain('pnpm run performance:gate');
  });

  it('prints an agent-friendly calibration command when a budget entry is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'thx-performance-gate-'));
    const budgetPath = join(root, 'performance-budgets.json');
    const budgets = rootJSON('ts/bench/performance-budgets.json') as {
      codemods: Record<string, unknown>;
      rules: Record<string, unknown>;
    };
    const [firstRuleName] = Object.keys(budgets.rules);

    delete budgets.rules[firstRuleName ?? ''];
    writeFileSync(budgetPath, `${JSON.stringify(budgets)}\n`, 'utf-8');

    try {
      expect(() => {
        execFileSync(
          'pnpm',
          ['exec', 'tsx', 'ts/bench/performance-gate.ts', '--check', '--budget', budgetPath],
          {
            cwd: repoRoot,
            stdio: 'pipe',
          },
        );
      }).toThrow(
        /Performance budget manifest is out of sync[\s\S]*Run: pnpm run performance:calibrate/u,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
