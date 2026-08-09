import { parseSync, visitorKeys } from 'oxc-parser';

export interface BenchmarkHits {
  nativeReferenceHits: number;
  onReferenceEntry?: () => void;
}

export interface BudgetEntry {
  inputSamples: number;
  iterations: number;
  medianLimitNs: number;
  observedMedianNs: number;
  observedP95Ns: number;
  operationsPerSample: number;
  p95LimitNs: number;
  runs: number;
}

export interface BudgetFile {
  codemods: Record<string, BudgetEntry>;
  rules: Record<string, BudgetEntry>;
}

export interface BenchRow {
  inputSamples: number;
  iterations: number;
  medianNs: number;
  name: string;
  operationsPerSample: number;
  p95Ns: number;
}

export interface ASTNode {
  [key: string]: unknown;
  end?: number;
  name?: string;
  start?: number;
  type: string;
}

export type VisitorMap = Record<string, ((node: object) => void) | undefined>;

export interface Fixture {
  ast?: ASTNode;
  dispatchCache?: Map<string, readonly ASTNode[]>;
  filename: string;
  source: string;
  sourceCode?: ReturnType<typeof nativeSourceCode>;
  visitorNodes?: readonly ASTNode[];
}

type Shadow = readonly [name: string, start: number, end: number];

const isNode = (value: unknown): value is ASTNode =>
  Boolean(
    value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string',
  );

const walk = (node: unknown, visit: (node: ASTNode) => void): void => {
  if (!isNode(node)) {
    return;
  }
  visit(node);
  for (const key of visitorKeys[node.type] ?? []) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, visit);
      }
    } else {
      walk(value, visit);
    }
  }
};

const nativeSourceCode = (program: ASTNode, source: string, hits: BenchmarkHits) => {
  const imports = new Set<string>();
  const shadows: Shadow[] = [];
  const references: object[] = [];
  const globals = new WeakSet<object>();
  walk(program, (node): void => {
    if (node.type.startsWith('Import') && node.type.endsWith('Specifier')) {
      const local = node.local as ASTNode | undefined;
      if (local?.name) {
        imports.add(local.name);
      }
    }
    if (node.type.includes('Function')) {
      for (const parameter of (node.params as ASTNode[]) ?? []) {
        if (parameter.type === 'Identifier' && parameter.name) {
          shadows.push([parameter.name, node.start ?? 0, node.end ?? Infinity]);
        }
      }
    }
  });
  walk(program, (node): void => {
    if (node.type !== 'Identifier') {
      return;
    }
    const position = node.start ?? 0;
    const isShadowed = shadows.some(
      ([name, start, end]): boolean => name === node.name && start <= position && position <= end,
    );
    const definitionType = isShadowed
      ? 'Variable'
      : imports.has(node.name ?? '')
        ? 'ImportBinding'
        : undefined;
    references.push({
      identifier: node,
      resolved: definitionType ? { defs: [{ type: definitionType }] } : null,
    });
    if (!definitionType && (node.name === 'Promise' || node.name === 'fetch')) {
      globals.add(node);
    }
  });
  const scopeManager = {
    get scopes(): readonly object[] {
      hits.nativeReferenceHits += 1;
      hits.onReferenceEntry?.();
      return [{ references }];
    },
  };
  return {
    getText: (): string => source,
    isGlobalReference: (node: object): boolean => globals.has(node),
    scopeManager,
    text: source,
    visitorKeys,
  };
};

export const parseFixture = (fixture: Fixture, hits: BenchmarkHits): Fixture => {
  const parsed = parseSync(fixture.filename, fixture.source, { sourceType: 'module' });
  const ast = parsed.program as unknown as ASTNode;
  const visitorNodes: ASTNode[] = [];
  walk(ast, (node): void => {
    visitorNodes.push(node);
  });
  return {
    ...fixture,
    ast,
    dispatchCache: new Map(),
    sourceCode: nativeSourceCode(ast, fixture.source, hits),
    visitorNodes,
  };
};

type SourceCode = ReturnType<typeof nativeSourceCode>;
type SourceCodeKey = keyof SourceCode;

export const withSourceCodeServices = (
  fixture: Fixture,
  names: readonly SourceCodeKey[],
): Fixture => {
  const sourceCode = fixture.sourceCode;
  if (!sourceCode) {
    return fixture;
  }
  return {
    ...fixture,
    sourceCode: Object.fromEntries(names.map((name) => [name, sourceCode[name]])) as SourceCode,
  };
};

export const dispatchNodes = (
  name: string,
  fixture: Fixture,
  visitors: VisitorMap,
): readonly ASTNode[] => {
  const cached = fixture.dispatchCache?.get(name);
  if (cached) {
    return cached;
  }
  const visitorTypes = new Set(Object.keys(visitors));
  const nodes = fixture.visitorNodes?.filter((node): boolean => visitorTypes.has(node.type)) ?? [];
  fixture.dispatchCache?.set(name, nodes);
  return nodes;
};
