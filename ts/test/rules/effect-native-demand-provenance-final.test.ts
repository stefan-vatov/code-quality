import type { NativeReference, NativeSourceCode } from '../../src/rules/effect-native-references';
import { describe, expect, it } from 'vitest';
import type { Context, VisitorMap } from '../../src/rules/effect-rule-core';
import { type ASTNode, type ASTValue, isASTArray, isASTNode } from '../../src/rules/effect-ast';
import { effectGlobalFetchAST } from '../../src/rules/effect-global-fetch-ast';
import { importedEffectCallMatcher } from '../../src/rules/effect-imported-call-matcher';
import { parseSync } from 'oxc-parser';

const domainFile = 'src/domain/native-demand.ts';

const visitNode = (value: ASTValue, visit: (node: ASTNode) => void): void => {
  if (isASTArray(value)) {
    for (const item of value) {
      visitNode(item, visit);
    }
    return;
  }
  if (!isASTNode(value)) {
    return;
  }
  visit(value);
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'parent') {
      visitNode(child, visit);
    }
  }
};

const parseProgram = (source: string): ASTNode =>
  // SAFETY: Oxc produces a Program with a string type and AST-valued fields consumed by this traversal.
  parseSync(domainFile, source, { sourceType: 'module' }).program as ASTNode &
    ReturnType<typeof parseSync>['program'];

const nodesOfType = (program: ASTNode, type: string): ASTNode[] => {
  const nodes: ASTNode[] = [];
  visitNode(program, (node): void => {
    if (node.type === type) {
      nodes.push(node);
    }
  });
  return nodes;
};

const lastIdentifier = (program: ASTNode, name: string): ASTNode => {
  const identifiers = nodesOfType(program, 'Identifier').filter(
    (node): boolean => node.name === name,
  );
  const identifier = identifiers.at(-1);
  if (!identifier) {
    throw new Error(`Missing ${name} reference`);
  }
  return identifier;
};

const importReference = (node: ASTNode): NativeReference => ({
  identifier: node,
  resolved: { defs: [{ type: 'ImportBinding' }] },
});

const localReference = (node: ASTNode): NativeReference => ({
  identifier: node,
  resolved: { defs: [{ type: 'Variable' }] },
});

interface NativeHarness {
  context: Context;
  referenceReads: () => number;
}

const nativeHarness = (
  source: string,
  references: readonly NativeReference[],
  globalReferences: ReadonlySet<object>,
  reports: object[],
): NativeHarness => {
  let referenceReads = 0;
  const scope = Object.defineProperty({}, 'references', {
    get(): readonly NativeReference[] {
      referenceReads += 1;
      return references;
    },
  });
  const sourceCode: NativeSourceCode & { text: string } = {
    isGlobalReference(node): boolean {
      return globalReferences.has(node);
    },
    scopeManager: { scopes: [scope] },
    text: source,
  };
  return {
    context: {
      report(descriptor): void {
        reports.push(descriptor);
      },
      sourceCode,
    },
    referenceReads: (): number => referenceReads,
  };
};

const runHostVisitors = (program: ASTNode, visitors: VisitorMap): void => {
  visitors.Program?.(program);
  visitNode(program, (node): void => {
    if (node !== program) {
      visitors[node.type]?.(node);
    }
  });
};

describe('candidate-gated native reference demand', (): void => {
  it('does not index global-fetch references for fetch outside an Effect wrapper', (): void => {
    const source = `
      import { Effect } from "effect";
      const response = fetch("/users");
      export const request = Effect.succeed(response);
    `;
    const program = parseProgram(source);
    const reports: object[] = [];
    const harness = nativeHarness(
      source,
      [importReference(lastIdentifier(program, 'Effect'))],
      new Set([lastIdentifier(program, 'fetch')]),
      reports,
    );

    runHostVisitors(program, effectGlobalFetchAST(harness.context, source));

    expect(reports).toHaveLength(0);
    expect(harness.referenceReads()).toBe(0);
  });

  it('does not index global-fetch references without an applicable Effect binding', (): void => {
    const source = `
      import { Option } from "effect";
      const request = LocalEffect.tryPromise(() => fetch("/users"));
    `;
    const program = parseProgram(source);
    const reports: object[] = [];
    const harness = nativeHarness(source, [], new Set([lastIdentifier(program, 'fetch')]), reports);

    runHostVisitors(program, effectGlobalFetchAST(harness.context, source));

    expect(reports).toHaveLength(0);
    expect(harness.referenceReads()).toBe(0);
  });

  it('defers imported matcher indexing until an applicable callee is queried', (): void => {
    const source = `
      import { succeed as complete } from "effect/Effect";
      const succeed = localSucceed;
      void complete;
    `;
    const program = parseProgram(source);
    const reports: object[] = [];
    const harness = nativeHarness(source, [], new Set(), reports);
    const matcher = importedEffectCallMatcher(harness.context, 'Effect', ['succeed']);

    matcher.initialize(program);

    expect(reports).toHaveLength(0);
    expect(harness.referenceReads()).toBe(0);
  });

  it('indexes exactly once when an imported matcher receives a candidate', (): void => {
    const source = `
      import { succeed as complete } from "effect/Effect";
      const request = complete(undefined);
    `;
    const program = parseProgram(source);
    const complete = lastIdentifier(program, 'complete');
    const reports: object[] = [];
    const harness = nativeHarness(source, [importReference(complete)], new Set(), reports);
    const matcher = importedEffectCallMatcher(harness.context, 'Effect', ['succeed']);

    matcher.initialize(program);

    expect(matcher.matches(complete)).toBe(true);
    expect(harness.referenceReads()).toBe(1);
  });
});

interface FetchCase {
  globalNames: readonly string[];
  importedNames: readonly string[];
  localNames?: readonly string[];
  source: string;
}

const runNativeGlobalFetch = (testCase: FetchCase) => {
  const program = parseProgram(testCase.source);
  const references = [
    ...testCase.importedNames.map(
      (name): NativeReference => importReference(lastIdentifier(program, name)),
    ),
    ...(testCase.localNames ?? []).map(
      (name): NativeReference => localReference(lastIdentifier(program, name)),
    ),
  ];
  const globalReferences = new Set(
    testCase.globalNames.map((name): object => lastIdentifier(program, name)),
  );
  const reports: object[] = [];
  const harness = nativeHarness(testCase.source, references, globalReferences, reports);

  runHostVisitors(program, effectGlobalFetchAST(harness.context, testCase.source));

  return { referenceReads: harness.referenceReads(), reports };
};

describe('root Effect namespace and computed global fetch provenance', (): void => {
  it('reports direct global fetch through Root.Effect.tryPromise', (): void => {
    const result = runNativeGlobalFetch({
      globalNames: ['fetch'],
      importedNames: ['Root'],
      source: `
        import * as Root from "effect";
        export const request = Root.Effect.tryPromise(() => fetch("/users"));
      `,
    });

    expect(result.reports).toHaveLength(1);
    expect(result.referenceReads).toBe(1);
  });

  it('reports computed globalThis fetch through Effect.tryPromise', (): void => {
    const result = runNativeGlobalFetch({
      globalNames: ['globalThis'],
      importedNames: ['Effect'],
      source: `
        import { Effect } from "effect";
        export const request = Effect.tryPromise(() => globalThis["fetch"]("/users"));
      `,
    });

    expect(result.reports).toHaveLength(1);
    expect(result.referenceReads).toBe(1);
  });

  it('supports root namespaces and computed globalThis fetch together', (): void => {
    const result = runNativeGlobalFetch({
      globalNames: ['globalThis'],
      importedNames: ['Root'],
      source: `
        import * as Root from "effect";
        export const request = Root.Effect.tryPromise(
          () => globalThis["fetch"]("/users"),
        );
      `,
    });

    expect(result.reports).toHaveLength(1);
    expect(result.referenceReads).toBe(1);
  });

  it('allows Root.Effect when Root resolves to a local parameter', (): void => {
    const result = runNativeGlobalFetch({
      globalNames: ['fetch'],
      importedNames: [],
      localNames: ['Root'],
      source: `
        import * as EffectRoot from "effect";
        export const request = (Root: LocalEffectRoot) =>
          Root.Effect.tryPromise(() => fetch("/users"));
      `,
    });

    expect(result.reports).toHaveLength(0);
    expect(result.referenceReads).toBe(0);
  });

  it('allows computed fetch when globalThis resolves to a local parameter', (): void => {
    const result = runNativeGlobalFetch({
      globalNames: [],
      importedNames: ['Effect'],
      localNames: ['globalThis'],
      source: `
        import { Effect } from "effect";
        export const request = (globalThis: HTTPClient) =>
          Effect.tryPromise(() => globalThis["fetch"]("/users"));
      `,
    });

    expect(result.reports).toHaveLength(0);
    expect(result.referenceReads).toBe(1);
  });

  it.each([
    ['dynamic globalThis properties', 'globalThis[operation]("/users")'],
    ['computed local receivers', 'client["fetch"]("/users")'],
  ])('does not broaden computed matching to %s', (_label, expression): void => {
    const result = runNativeGlobalFetch({
      globalNames: expression.startsWith('globalThis') ? ['globalThis'] : [],
      importedNames: ['Effect'],
      source: `
        import { Effect } from "effect";
        const operation = "fetch";
        const client = makeClient();
        export const request = Effect.tryPromise(() => ${expression});
      `,
    });

    expect(result.reports).toHaveLength(0);
    expect(result.referenceReads).toBe(1);
  });
});
