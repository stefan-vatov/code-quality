import type { BenchRow, BudgetEntry } from './performance-gate-support';

export const percentile = (values: readonly number[], percentileValue: number): number =>
  [...values].sort((left, right) => left - right)[
    Math.max(0, Math.ceil(values.length * percentileValue) - 1)
  ] ?? 0;

export const measureBenchmark = <Input>(
  name: string,
  inputs: readonly Input[],
  iterations: number,
  operationsPerSample: number,
  fn: (input: Input) => void,
  warmupIterations: number,
  inputSamples = inputs.length,
): BenchRow => {
  const times: number[] = [];
  for (let iteration = 0; iteration < warmupIterations; iteration += 1) {
    fn(inputs[iteration % inputs.length]);
  }
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = process.hrtime.bigint();
    for (let operation = 0; operation < operationsPerSample; operation += 1) {
      fn(inputs[(iteration + operation) % inputs.length]);
    }
    times.push(Number(process.hrtime.bigint() - startedAt) / operationsPerSample);
  }
  return {
    inputSamples,
    iterations,
    medianNs: percentile(times, 0.5),
    name,
    operationsPerSample,
    p95Ns: percentile(times, 0.95),
  };
};

export const measurePreparedBenchmark = <Input>(
  name: string,
  iterations: number,
  operationsPerSample: number,
  prepare: (sample: number) => Input,
  fn: (input: Input) => void,
  inputSamples: number,
): BenchRow => {
  const times: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const input = prepare(iteration);
    const startedAt = process.hrtime.bigint();
    for (let operation = 0; operation < operationsPerSample; operation += 1) {
      fn(input);
    }
    times.push(Number(process.hrtime.bigint() - startedAt) / operationsPerSample);
  }
  return {
    inputSamples,
    iterations,
    medianNs: percentile(times, 0.5),
    name,
    operationsPerSample,
    p95Ns: percentile(times, 0.95),
  };
};

export const budgetEntry = (
  rows: readonly BenchRow[],
  runs: number,
  medianFloorNs: number,
  p95FloorNs: number,
  limitMultiplier: number,
): BudgetEntry => {
  const observedP95Ns = Math.max(...rows.map((row) => row.p95Ns));
  const observedMedianNs = Math.max(...rows.map((row) => row.medianNs));
  return {
    inputSamples: rows[0]?.inputSamples ?? 0,
    iterations: rows[0]?.iterations ?? 0,
    medianLimitNs: Math.ceil(Math.max(medianFloorNs, observedMedianNs * limitMultiplier)),
    observedMedianNs,
    observedP95Ns,
    operationsPerSample: rows[0]?.operationsPerSample ?? 0,
    p95LimitNs: Math.ceil(Math.max(p95FloorNs, observedP95Ns * limitMultiplier)),
    runs,
  };
};

export const groupedBudgets = (
  rows: readonly BenchRow[],
  runs: number,
  medianFloorNs: number,
  p95FloorNs: number,
  limitMultiplier: number,
): Record<string, BudgetEntry> =>
  Object.fromEntries(
    [...new Set(rows.map((row) => row.name))].sort().map((name) => [
      name,
      budgetEntry(
        rows.filter((row): boolean => row.name === name),
        runs,
        medianFloorNs,
        p95FloorNs,
        limitMultiplier,
      ),
    ]),
  );
