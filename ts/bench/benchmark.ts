/**
 * Reusable micro-benchmark runner for custom lint rules.
 *
 * Usage:
 *   benchmark('isPascalCase', isPascalCase, { inputs: [...], iterations: 100_000 });
 *
 * Features:
 *   - Warmup phase (discarded)
 *   - Timed measurement with median and p95
 *   - Compare baseline vs optimized
 *   - Output in markdown table format
 */

interface BenchResult {
  name: string;
  totalMs: number;
  iterations: number;
  opsPerSec: number;
  medianPerOpNs: number;
  p95PerOpNs: number;
  inputSamples: number;
}

interface BenchConfig {
  fn: (input: string) => unknown;
  inputs: string[];
  iterations: number;
}

function benchOnce(config: BenchConfig): BenchResult {
  const { fn, inputs, iterations } = config;
  const times: number[] = [];
  let total = 0;

  // Collect per-iteration timing
  for (let i = 0; i < iterations; i++) {
    const input = inputs[i % inputs.length];
    const start = process.hrtime.bigint();
    fn(input);
    const end = process.hrtime.bigint();
    const ns = Number(end - start);
    times.push(ns);
    total += ns;
  }

  // Sort for percentile calculation
  times.sort((a, b) => a - b);

  const medianPerOpNs = times[Math.floor(times.length / 2)];
  const p95Idx = Math.floor(times.length * 0.95);
  const p95PerOpNs = times[p95Idx];

  return {
    name: 'bench',
    totalMs: total / 1_000_000,
    iterations,
    opsPerSec: Math.round(iterations / (total / 1_000_000_000)),
    medianPerOpNs,
    p95PerOpNs,
    inputSamples: inputs.length,
  };
}

export function benchmark(
  label: string,
  fn: (input: string) => unknown,
  inputs: string[],
  iterations = 50_000,
): BenchResult {
  // Warmup: run at 10% scale, discarded
  const warmupIters = Math.max(100, Math.floor(iterations / 10));
  benchOnce({ fn, inputs, iterations: warmupIters });

  // Real measurement
  const result = benchOnce({ fn, inputs, iterations });
  result.name = label;
  return result;
}

export function formatResult(r: BenchResult): string {
  return [
    `| ${r.name.padEnd(28)} `,
    `| ${r.opsPerSec.toLocaleString().padStart(12)} ops/s `,
    `| ${r.medianPerOpNs.toLocaleString().padStart(6)} ns `,
    `| ${r.p95PerOpNs.toLocaleString().padStart(6)} ns `,
    `| ${r.totalMs.toFixed(2).padStart(8)} ms `,
    `| ${r.inputSamples.toString().padStart(4)} inputs |`,
  ].join('');
}

export function formatHeader(): string {
  return [
    `| Rule                        | ops/sec       | median | p95    | total ms | inputs |`,
    `|-----------------------------|---------------|--------|--------|----------|--------|`,
  ].join('\n');
}

export function compareResults(before: BenchResult, after: BenchResult): string {
  const delta =
    before.medianPerOpNs > 0
      ? (((before.medianPerOpNs - after.medianPerOpNs) / before.medianPerOpNs) * 100).toFixed(1)
      : '0.0';
  const faster = parseFloat(delta) > 0;
  return [
    `before: ${formatResult({ ...before, name: before.name + ' (before)' })}`,
    `after:  ${formatResult({ ...after, name: after.name + ' (after)' })}`,
    `change: ${faster ? '▲' : '▼'} ${delta}% ${faster ? 'faster' : 'slower'}`,
  ].join('\n');
}
