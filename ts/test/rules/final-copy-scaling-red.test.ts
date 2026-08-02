import { asNode, childNode, childNodes, identifierName } from '../../src/rules/effect-ast';
import { describe, expect, it } from 'vitest';
import {
  exportedDeclarationSegments,
  exportedDeclarationTexts,
} from '../../src/rules/effect-exported-declarations';
import type { ASTNode } from '../../src/rules/effect-ast';
import type { Context } from '../../src/rules/effect-rule-core';
import { effectSyncForPromiseAST } from '../../src/rules/effect-default-boundary-ast';
import { hasExecutedPromiseBoundary } from '../../src/rules/effect-promise-execution-ast';
import { hasRecursiveEffectSource } from '../../src/rules/effect-recursion-source';
import { indexPromiseRuntimeTasks } from '../../src/rules/effect-promise-runtime-tasks';
import { parseSync } from 'oxc-parser';
import { performance } from 'node:perf_hooks';

interface Measurement {
  readonly bytes: number;
  readonly elapsedMs: number;
  readonly heapDeltaKB: number;
  readonly inputSize: number;
}

const SAMPLE_COUNT = 3;
const MEASURE_REPETITIONS = 5;

const median = (values: readonly number[]): number => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? 0;
};

const collectGarbage = (): void => {
  const runtime = globalThis as typeof globalThis & { ['gc']?: () => void };
  runtime['gc']?.();
};

const parseProgram = (filename: string, source: string): ASTNode => {
  const parsed = parseSync(filename, source, { sourceType: 'module' });
  if (parsed.errors.length > 0) {
    throw new Error(`invalid generated fixture ${filename}`);
  }
  return parsed.program as ASTNode;
};

const timed = (inputSize: number, bytes: number, invoke: () => void): Measurement => {
  invoke();
  const samples: number[] = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    const startedAt = performance.now();
    for (let repetition = 0; repetition < MEASURE_REPETITIONS; repetition += 1) {
      invoke();
    }
    samples.push((performance.now() - startedAt) / MEASURE_REPETITIONS);
  }
  collectGarbage();
  const before = process.memoryUsage().heapUsed;
  invoke();
  const after = process.memoryUsage().heapUsed;
  return {
    bytes,
    elapsedMs: median(samples),
    heapDeltaKB: Math.max(0, after - before) / 1024,
    inputSize,
  };
};

const ratio = (larger: Measurement, smaller: Measurement): number =>
  larger.elapsedMs / Math.max(smaller.elapsedMs, 0.01);

const ratioMessage = (label: string, larger: Measurement, smaller: Measurement): string =>
  `${label}: time ${ratio(larger, smaller).toFixed(2)}x, heap ${(larger.heapDeltaKB / Math.max(smaller.heapDeltaKB, 0.01)).toFixed(2)}x, ` +
  `${smaller.inputSize}/${smaller.bytes} -> ${larger.inputSize}/${larger.bytes}`;

const scopeSource = (depth: number): string => {
  let source = 'import { Effect } from "effect";\n';
  for (let index = 0; index < depth; index += 1) {
    source += `function level${index}(parameter${index}: unknown) {\n`;
  }
  return `${source}Effect.sync(() => Promise.resolve(1));\n${'}\n'.repeat(depth)}`;
};

const scopeShadowSource = (): string =>
  'import { Effect } from "effect"; function local() { const Promise = { resolve: () => 1 }; Effect.sync(() => Promise.resolve(1)); }';

const scopeReports = (source: string): number => {
  const program = parseProgram('final-copy-scope.ts', source);
  let reports = 0;
  const context: Context = {
    report(): void {
      reports += 1;
    },
  };
  effectSyncForPromiseAST(context, source).Program?.(program);
  return reports;
};

const scopeMeasurement = (depth: number): Measurement => {
  const source = scopeSource(depth);
  const program = parseProgram(`final-copy-scope-${depth}.ts`, source);
  const invoke = (): void => {
    let reports = 0;
    const context: Context = {
      report(): void {
        reports += 1;
      },
    };
    effectSyncForPromiseAST(context, source).Program?.(program);
    if (reports !== 1) {
      throw new Error(`unshadowed Promise semantics changed at scope depth ${depth}`);
    }
  };
  return timed(depth, source.length, invoke);
};

const exportedSource = (count: number, variant: number): string => {
  const names = Array.from({ length: count }, (_, index) => `value${index}`);
  const declarations = names.map((name, index) => `${name} = ${index}`).join(', ');
  return `const ${declarations}, privateValue = Promise.resolve(${variant});\nexport { ${names.join(', ')} };\n`;
};

const exportedMeasurement = (count: number): Measurement => {
  let variant = 0;
  const baselineSource = exportedSource(count, variant);
  const invoke = (): void => {
    variant += 1;
    const declarations = exportedDeclarationTexts(exportedSource(count, variant));
    if (
      declarations.length !== count ||
      declarations.some((declaration) => declaration.includes('privateValue'))
    ) {
      throw new Error(`export projection semantics changed at declaration count ${count}`);
    }
  };
  const baseline = exportedDeclarationTexts(baselineSource);
  if (baseline.length !== count) {
    throw new Error(`export projection count changed at declaration count ${count}`);
  }
  const segments = exportedDeclarationSegments(exportedSource(Math.min(count, 8), 10));
  if (segments.length !== Math.min(count, 8)) {
    throw new Error(`export segment semantics changed at declaration count ${count}`);
  }
  return timed(count, baselineSource.length, invoke);
};

const flowSource = (depth: number, unsafe: boolean): string =>
  'import { Effect } from "effect";\nEffect.sync(() => {\n' +
  `  ${'{\n'.repeat(depth)}${unsafe ? 'return Promise.resolve(1);' : 'return 1;'}\n` +
  `  ${'}\n'.repeat(depth)}});\n`;

const promiseResolveCall = (node: ASTNode): boolean => {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const callee = childNode(node, 'callee');
  return (
    identifierName(childNode(callee, 'object')) === 'Promise' &&
    identifierName(childNode(callee, 'property')) === 'resolve'
  );
};

const callbackFor = (depth: number): { readonly callback: ASTNode; readonly source: string } => {
  const source = flowSource(depth, true);
  const program = parseProgram(`final-copy-flow-${depth}.ts`, source);
  const statement = childNodes(program, 'body')[1];
  const call = childNode(statement, 'expression');
  const callback = childNodes(call, 'arguments')[0];
  if (!callback) {
    throw new Error(`missing Promise callback at block depth ${depth}`);
  }
  return { callback, source };
};

const flowResult = (callback: ASTNode): boolean =>
  hasExecutedPromiseBoundary({
    functionNode: callback,
    helperScopes: [],
    isBoundary: promiseResolveCall,
    scopes: [],
  });

const flowMeasurement = (depth: number): Measurement => {
  const { callback, source } = callbackFor(depth);
  const invoke = (): void => {
    if (!flowResult(callback)) {
      throw new Error(`Promise boundary semantics changed at block depth ${depth}`);
    }
  };
  return timed(depth, source.length, invoke);
};

const effectCallName = (node: ASTNode): string | undefined => {
  if (node.type !== 'CallExpression') {
    return undefined;
  }
  const callee = childNode(node, 'callee');
  if (callee?.type !== 'MemberExpression') {
    return undefined;
  }
  if (identifierName(childNode(callee, 'object')) !== 'Effect') {
    return undefined;
  }
  return identifierName(childNode(callee, 'property'));
};

const collectCalls = (value: unknown, calls: ASTNode[] = []): ASTNode[] => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectCalls(item, calls);
    }
    return calls;
  }
  const node = asNode(value);
  if (!node) {
    return calls;
  }
  if (node.type === 'CallExpression') {
    calls.push(node);
  }
  for (const key of Object.keys(node)) {
    if (key !== 'parent') {
      collectCalls(Reflect.get(node, key), calls);
    }
  }
  return calls;
};

const runtimeSource = (depth: number): string => {
  let source =
    'import { Effect } from "effect";\nconst task = Effect.sync(() => Promise.resolve(1));\n';
  for (let index = 0; index < depth; index += 1) {
    source += `{ const local${index} = ${index};\n`;
  }
  return `${source}Effect.runSync(task);\n${'}\n'.repeat(depth)}`;
};

const runtimeMeasurement = (depth: number): Measurement => {
  const source = runtimeSource(depth);
  const program = parseProgram(`final-copy-runtime-${depth}.ts`, source);
  const calls = collectCalls(program);
  const syncCall = calls.find((call): boolean => effectCallName(call) === 'sync');
  if (!syncCall) {
    throw new Error(`missing runtime task at block depth ${depth}`);
  }
  const invoke = (): void => {
    const tasks = indexPromiseRuntimeTasks(
      program,
      (node): boolean => effectCallName(node) === 'sync',
      (node): boolean => effectCallName(node) === 'runSync',
    );
    if (!tasks.deferredSyncCalls.has(syncCall)) {
      throw new Error(`runtime task semantics changed at block depth ${depth}`);
    }
  };
  return timed(depth, source.length, invoke);
};

const recursionSource = (count: number): string =>
  `import { Effect } from "effect";\n${Array.from(
    { length: count },
    (_, index) => `const generic${index} = <T,>(value: T): T => value;\n`,
  ).join('')}Effect.succeed(1);\n`;

const recursionMeasurement = (count: number): Measurement => {
  const source = recursionSource(count);
  const invoke = (): void => {
    if (hasRecursiveEffectSource(source)) {
      throw new Error(`generic arrow semantics changed at arrow count ${count}`);
    }
  };
  return timed(count, source.length, invoke);
};

const scopeSmall = scopeMeasurement(128);
const scopeLarge = scopeMeasurement(1280);
const exportedSmall = exportedMeasurement(256);
const exportedLarge = exportedMeasurement(2048);
const flowSmall = flowMeasurement(128);
const flowLarge = flowMeasurement(1024);
const runtimeSmall = runtimeMeasurement(64);
const runtimeLarge = runtimeMeasurement(768);
const recursionSmall = recursionMeasurement(256);
const recursionLarge = recursionMeasurement(1280);

describe('final immutable-copy scaling RED audit', (): void => {
  it('keeps AST scope extension near-linear while preserving shadowing', (): void => {
    expect(scopeReports(scopeSource(4))).toBe(1);
    expect(scopeReports(scopeShadowSource())).toBe(0);
    expect(
      ratio(scopeLarge, scopeSmall),
      ratioMessage('effect-ast-scope', scopeLarge, scopeSmall),
    ).toBeLessThan(12);
  });

  it('keeps exported sibling projection near-linear while preserving private siblings', (): void => {
    expect(exportedDeclarationTexts(exportedSource(4, 30))).toEqual([
      'const value0 = 0;',
      'const value1 = 1;',
      'const value2 = 2;',
      'const value3 = 3;',
    ]);
    expect(
      ratio(exportedLarge, exportedSmall),
      ratioMessage('effect-exported-declarations', exportedLarge, exportedSmall),
    ).toBeLessThan(18);
  });

  it('keeps Promise block environments near-linear while preserving boundary results', (): void => {
    const safe = flowSource(4, false);
    const safeProgram = parseProgram('final-copy-flow-safe.ts', safe);
    const safeCallback = childNodes(
      childNode(childNodes(safeProgram, 'body')[1], 'expression'),
      'arguments',
    )[0];
    expect(safeCallback ? flowResult(safeCallback) : true).toBe(false);
    expect(
      ratio(flowLarge, flowSmall),
      ratioMessage('effect-promise-execution-flow', flowLarge, flowSmall),
    ).toBeLessThan(12);
  });

  it('keeps runtime container scope extension near-linear while preserving task discovery', (): void => {
    expect(runtimeSmall.inputSize).toBeLessThan(runtimeLarge.inputSize);
    expect(
      ratio(runtimeLarge, runtimeSmall),
      ratioMessage('effect-promise-runtime-statements', runtimeLarge, runtimeSmall),
    ).toBeLessThan(18);
  });

  it('keeps generic arrow restoration near-linear while preserving recursion semantics', (): void => {
    expect(hasRecursiveEffectSource(recursionSource(4))).toBe(false);
    expect(
      hasRecursiveEffectSource(
        'import { Effect } from "effect"; const recurse = <T,>(value: T): T => Effect.succeed(recurse(value));',
      ),
    ).toBe(true);
    expect(
      ratio(recursionLarge, recursionSmall),
      ratioMessage('effect-recursion-source', recursionLarge, recursionSmall),
    ).toBeLessThan(24);
  });
});
