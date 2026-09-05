import { describe, expect, it, vi } from 'vitest';
import * as importedCallMatcher from '../../src/rules/effect-imported-call-matcher';
import { effectStrictASTSpecs } from '../../src/rules/effect-strict-ast-specs';
import type { ASTNode } from '../../src/rules/effect-ast';
import {
  hasHTTPClientResponseWithoutSchema,
  hasSharedResourceForEachWithoutSemaphore,
} from '../../src/rules/effect-strict-helpers';
import {
  hasLayerFactory,
  hasUnsafeResourceStream,
} from '../../src/rules/effect-strict-segment-helpers';
import { fileURLToPath } from 'node:url';
import { hasExternalEffectWithoutTimeout } from '../../src/rules/effect-strict-external-helpers';
import { readFileSync } from 'node:fs';

const strictSegmentHelpersPath = fileURLToPath(
  new URL('../../src/rules/effect-strict-segment-helpers.ts', import.meta.url),
);
const strictExternalHelpersPath = fileURLToPath(
  new URL('../../src/rules/effect-strict-external-helpers.ts', import.meta.url),
);
const strictRulesSource = (): string =>
  [
    '../../src/rules/effect-strict-core-specs.ts',
    '../../src/rules/effect-strict-ast-specs.ts',
    '../../src/rules/effect-strict-internals.ts',
  ]
    .map((path): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf-8'))
    .join('\n');

describe('Effect strict helper performance invariants', (): void => {
  it('returns false when necessary strict-rule tokens are absent', (): void => {
    const irrelevantSource = 'const value = 1;\n'.repeat(1000);

    expect([
      hasLayerFactory(irrelevantSource),
      hasSharedResourceForEachWithoutSemaphore(irrelevantSource),
      hasHTTPClientResponseWithoutSchema(irrelevantSource),
      hasExternalEffectWithoutTimeout(irrelevantSource),
      hasUnsafeResourceStream(irrelevantSource),
    ]).toStrictEqual([false, false, false, false, false]);
  });

  it('hoists Effect call predicates out of strict CallExpression visitor hot paths', (): void => {
    const factory = vi.spyOn(importedCallMatcher, 'importedEffectCallMatcher');
    const report = vi.fn();
    const context = { report };
    const spec = effectStrictASTSpecs.find((rule) => rule.name === 'effect-prefer-effect-void');
    const call: ASTNode = {
      type: 'CallExpression',
      callee: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'Effect' },
        property: { type: 'Identifier', name: 'succeed' },
      },
      arguments: [],
    };
    try {
      const visitors = spec?.ast?.(context, 'Effect.succeed();');
      expect(factory).toHaveBeenCalledExactlyOnceWith(context, 'Effect', ['succeed']);
      const result = factory.mock.results[0];
      if (result?.type !== 'return') {
        throw new Error('Expected the visitor factory to construct an imported call matcher');
      }
      const matcher = result.value;
      expect(visitors?.Program).toBe(matcher.initialize);
      visitors?.Program?.({
        type: 'Program',
        body: [{ type: 'ExpressionStatement', expression: call }],
      });
      for (let index = 0; index < 3; index++) {
        visitors?.CallExpression?.(call);
      }
      expect(report).toHaveBeenCalledTimes(3);
      expect(factory).toHaveBeenCalledTimes(1);
      spec?.ast?.({ report }, 'Effect.succeed();');
      expect(factory).toHaveBeenCalledTimes(2);
      expect(factory.mock.results[1]?.value).not.toBe(matcher);
    } finally {
      factory.mockRestore();
    }
  });

  it('uses necessary-call tokens for strict AST rules', (): void => {
    const source = strictRulesSource();

    expect(source).toContain("name: 'effect-prefer-effect-void',");
    expect(source).toContain("tokens: ['succeed'],");
  });

  it('uses broad identifier tokens for strict environment escape-hatch rules', (): void => {
    const source = strictRulesSource();

    expect(source).toContain("tokens: ['process'],");
    expect(source).toContain("tokens: ['Date', 'Math'],");
  });

  it('caches local external call segments shared by timeout retry and span rules', (): void => {
    const source = readFileSync(strictSegmentHelpersPath, 'utf-8');

    expect(source).toContain('localEffectCallSegmentCache');
    expect(source).toContain('enclosingEffectWrapperSegmentCache');
    expect(source).not.toContain('localEffectCallSegmentCache.delete(source)');
    expect(source).not.toContain('enclosingEffectWrapperSegmentCache.delete(source)');
  });

  it('hoists external call scanner patterns out of strict helper hot paths', (): void => {
    const source = readFileSync(strictExternalHelpersPath, 'utf-8');

    expect(source).toContain('const EXTERNAL_CALL_PATTERN =');
    expect(source).toContain('const IDEMPOTENT_EXTERNAL_CALL_PATTERN =');
    expect(source).not.toContain('const externalCallPattern =');
    expect(source).not.toContain('const idempotentPattern =');
  });

  it('uses an allocation-free pipe operator scanner for external-effect checks', (): void => {
    const source = readFileSync(strictSegmentHelpersPath, 'utf-8');
    const scannerStart = source.indexOf('const hasTopLevelPipeOperator');
    const scannerEnd = source.indexOf('const hasExternalEffectWithoutTimeout');
    const scannerSource = source.slice(scannerStart, scannerEnd);

    expect(scannerSource).toContain('operatorNeedle');
    expect(scannerSource).not.toContain('new RegExp');
    expect(scannerSource).not.toContain('operatorPattern');
  });
});
