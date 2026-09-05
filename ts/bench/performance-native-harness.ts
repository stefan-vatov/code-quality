import { RuleTester } from 'oxlint/plugins-dev';
import type { Context, ESTree, Rule, SourceCode, VisitorWithHooks } from '@oxlint/plugins';
import { percentile } from './performance-gate-measurement';
import type { BenchRow, Fixture } from './performance-gate-support';

interface NativeBenchmarkOptions {
  cold: boolean;
  iterations: number;
  warmups: number;
}

interface NativeSample {
  fixture: Fixture;
  iterations: number;
  warmups: number;
}

interface NativeResult {
  reports: number;
  row: BenchRow;
}

type Dispatch = readonly [event: string, node: ESTree.Node];

const dispatchesFor = (program: ESTree.Program, sourceCode: SourceCode): Dispatch[] => {
  const dispatches: Dispatch[] = [];
  const pending: { node: ESTree.Node; exit: boolean }[] = [{ node: program, exit: false }];
  while (pending.length > 0) {
    const next = pending.pop();
    if (!next) break;
    const { node } = next;
    dispatches.push([next.exit ? `${node.type}:exit` : node.type, node]);
    if (next.exit) continue;
    pending.push({ node, exit: true });
    const children: ESTree.Node[] = [];
    for (const key of sourceCode.visitorKeys[node.type] ?? []) {
      // SAFETY: Oxlint's visitorKeys enumerate only child nodes and nullable child-node arrays.
      const value = (
        node as unknown as Record<string, ESTree.Node | (ESTree.Node | null)[] | null>
      )[key];
      if (Array.isArray(value)) {
        for (const child of value) if (child) children.push(child);
      } else if (value) children.push(value);
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({ node: children[index], exit: false });
    }
  }
  return dispatches;
};

const executeVisitors = (visitors: VisitorWithHooks, dispatches: readonly Dispatch[]): void => {
  if (visitors.before?.() === false) return;
  for (const [event, node] of dispatches) visitors[event]?.(node);
  visitors.after?.();
};

const nativeSamples = (
  fixtures: readonly Fixture[],
  options: NativeBenchmarkOptions,
): NativeSample[] => {
  if (options.cold) {
    return Array.from({ length: options.iterations }, (_, index) => {
      const fixture = fixtures[index % fixtures.length];
      return {
        fixture: {
          filename: fixture.filename.replace(/\.ts$/u, `.cold-${index}.ts`),
          source: `${fixture.source}${'\n'.repeat(index + 1)}`,
        },
        iterations: 1,
        warmups: 0,
      };
    });
  }
  return fixtures.map((fixture, index) => ({
    fixture,
    iterations: Math.max(0, Math.ceil((options.iterations - index) / fixtures.length)),
    warmups: Math.max(0, Math.ceil((options.warmups - index) / fixtures.length)),
  }));
};

/**
 * Run against Oxlint's real native AST, scopes, comments and parent links. The host
 * parses and prepares dispatches before timing. Each sample times a complete rule
 * traversal, including per-file create/before/after work. createOnce is host setup.
 * Reports are counted just like the existing Effect harness, without formatting diagnostics.
 * Hot samples repeat the same native file while its arena is alive; native nodes
 * must never escape a RuleTester case, because Oxlint reuses the backing arena.
 */
export const benchmarkNativeRule = (
  name: string,
  rule: Rule,
  fixtures: readonly Fixture[],
  options: NativeBenchmarkOptions,
): NativeResult => {
  const times: number[] = [];
  let reports = 0;
  let sampleReports = 0;
  let activeSample: NativeSample;
  const wrapper: Rule = {
    meta: rule.meta,
    createOnce(context) {
      // SAFETY: inherit the native context's live per-file getters, overriding only
      // the report sink to match the count-only sink used by the Effect benchmarks.
      const measuredContext = Object.create(context, {
        report: {
          value: (): void => {
            sampleReports += 1;
          },
        },
      }) as Context;
      const onceVisitors = 'createOnce' in rule ? rule.createOnce(measuredContext) : undefined;
      return {
        Program(program) {
          const dispatches = dispatchesFor(program, context.sourceCode);
          const run = (): void => {
            const visitors = onceVisitors ?? rule.create?.(measuredContext);
            if (!visitors) throw new Error(`${name} did not create native visitors`);
            executeVisitors(visitors, dispatches);
          };
          for (let index = 0; index < activeSample.warmups; index += 1) run();
          for (let index = 0; index < activeSample.iterations; index += 1) {
            sampleReports = 0;
            const start = process.hrtime.bigint();
            run();
            times.push(Number(process.hrtime.bigint() - start));
            reports += sampleReports;
          }
        },
      };
    },
  };
  const scheduling = { describe: RuleTester.describe, it: RuleTester.it };
  try {
    // RuleTester normally registers Vitest tests. Benchmarks execute synchronously,
    // including when called from regression tests, and restore the original scheduler.
    RuleTester.describe = (_text, run): void => {
      run();
    };
    RuleTester.it = (_text, run): void => {
      run();
    };
    const tester = new RuleTester({ languageOptions: { parserOptions: { lang: 'ts' } } });
    tester.run(name, wrapper, {
      valid: nativeSamples(fixtures, options).map((sample) => ({
        code: sample.fixture.source,
        filename: sample.fixture.filename,
        before(): void {
          activeSample = sample;
        },
      })),
      invalid: [],
    });
  } finally {
    RuleTester.describe = scheduling.describe;
    RuleTester.it = scheduling.it;
  }
  return {
    reports,
    row: {
      inputSamples: fixtures.length,
      iterations: times.length,
      medianNs: percentile(times, 0.5),
      name,
      operationsPerSample: 1,
      p95Ns: percentile(times, 0.95),
    },
  };
};
