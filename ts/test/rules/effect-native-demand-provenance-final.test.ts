import { parseSync } from 'oxc-parser';
import { describe, expect, it } from 'vitest';
import { type ASTNode, type ASTValue, isASTArray, isASTNode } from '../../src/rules/effect-ast';
import { importedEffectCallMatcher } from '../../src/rules/effect-imported-call-matcher';
import type { NativeReference, NativeSourceCode } from '../../src/rules/effect-native-references';
import type { Context } from '../../src/rules/effect-rule-core';

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

describe('candidate-gated native reference demand', (): void => {
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
