#!/usr/bin/env node
/* -------------------------------------------------------------------------- */
/*       Estimate custom rule and codemod runtime from calibrated budgets.    */
/* -------------------------------------------------------------------------- */
import { readFileSync } from 'node:fs';

interface BudgetEntry {
  observedMedianNs: number;
  observedP95Ns: number;
}

interface BudgetFile {
  codemods: Record<string, BudgetEntry>;
  rules: Record<string, BudgetEntry>;
}

interface Estimate {
  medianNs: number;
  p95Ns: number;
}

const defaultLOC = 1_000_000;
const defaultLinesPerFile = 250;
const nsPerMs = 1_000_000;
const nsPerSecond = 1_000_000_000;

const numericArg = (name: string, fallback: number): number => {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
};

const budgetPathArg = (): string => {
  const index = process.argv.indexOf('--budget');
  if (index === -1) {
    return new URL('./performance-budgets.json', import.meta.url).pathname;
  }
  return process.argv[index + 1] ?? '';
};

const readBudgets = (): BudgetFile =>
  JSON.parse(readFileSync(budgetPathArg(), 'utf-8')) as BudgetFile;

const sumEstimate = (entries: Record<string, BudgetEntry>, files: number): Estimate =>
  Object.values(entries).reduce(
    (estimate, entry) => ({
      medianNs: estimate.medianNs + entry.observedMedianNs * files,
      p95Ns: estimate.p95Ns + entry.observedP95Ns * files,
    }),
    { medianNs: 0, p95Ns: 0 },
  );

const addEstimates = (left: Estimate, right: Estimate): Estimate => ({
  medianNs: left.medianNs + right.medianNs,
  p95Ns: left.p95Ns + right.p95Ns,
});

const formatDuration = (nanoseconds: number): string => {
  if (nanoseconds < nsPerMs) {
    return `${Math.round(nanoseconds)} ns`;
  }
  if (nanoseconds < nsPerSecond) {
    return `${(nanoseconds / nsPerMs).toFixed(2)} ms`;
  }
  return `${(nanoseconds / nsPerSecond).toFixed(2)} s`;
};

const formatCount = (value: number): string => Math.round(value).toLocaleString();

const printRow = (label: string, estimate: Estimate): void => {
  process.stdout.write(
    `${label}: median ${formatDuration(estimate.medianNs)}, p95 ${formatDuration(estimate.p95Ns)}\n`,
  );
};

const loc = numericArg('--loc', defaultLOC);
const linesPerFile = numericArg('--lines-per-file', defaultLinesPerFile);
const files = Math.ceil(loc / linesPerFile);
const budgets = readBudgets();
const ruleEstimate = sumEstimate(budgets.rules, files);
const codemodEstimate = sumEstimate(budgets.codemods, files);
const combinedEstimate = addEstimates(ruleEstimate, codemodEstimate);

process.stdout.write(`Input LOC: ${formatCount(loc)}\n`);
process.stdout.write(`Average lines per file: ${formatCount(linesPerFile)}\n`);
process.stdout.write(`Estimated files: ${formatCount(files)}\n`);
process.stdout.write(`Tracked custom rules: ${formatCount(Object.keys(budgets.rules).length)}\n`);
process.stdout.write(`Tracked codemods: ${formatCount(Object.keys(budgets.codemods).length)}\n`);
printRow('Custom rule total', ruleEstimate);
printRow('Codemod total', codemodEstimate);
printRow('Combined total', combinedEstimate);
