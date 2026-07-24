import type { BenchRow, BudgetEntry, BudgetFile } from './performance-gate-support';

const missingEntries = (actual: readonly string[], expected: Record<string, unknown>): string[] =>
  actual.filter((name): boolean => !Object.hasOwn(expected, name));

const staleEntries = (actual: readonly string[], expected: Record<string, unknown>): string[] =>
  Object.keys(expected).filter((name): boolean => !actual.includes(name));

export const assertBudgetManifest = (
  ruleNames: readonly string[],
  codemodNames: readonly string[],
  budgets: BudgetFile,
): void => {
  const problems = [
    ...missingEntries(ruleNames, budgets.rules).map((name) => `missing rule budget: ${name}`),
    ...missingEntries(codemodNames, budgets.codemods).map(
      (name) => `missing codemod budget: ${name}`,
    ),
    ...staleEntries(ruleNames, budgets.rules).map((name) => `stale rule budget: ${name}`),
    ...staleEntries(codemodNames, budgets.codemods).map((name) => `stale codemod budget: ${name}`),
  ];
  if (problems.length > 0) {
    throw new Error(`Performance budget manifest is out of sync.\n${problems.join('\n')}`);
  }
};

export const failedBudgetRows = (
  kind: 'codemod' | 'rule',
  rows: readonly BenchRow[],
  budgets: Record<string, BudgetEntry>,
): string[] =>
  rows.flatMap((row) => {
    const budget = budgets[row.name];
    if (!budget) {
      return [`missing ${kind} budget: ${row.name}`];
    }
    if (row.p95Ns <= budget.p95LimitNs && row.medianNs <= budget.medianLimitNs) {
      return [];
    }
    return [
      `${kind} ${row.name} exceeded budget: median ${row.medianNs}ns/${budget.medianLimitNs}ns, p95 ${row.p95Ns}ns/${budget.p95LimitNs}ns`,
    ];
  });
