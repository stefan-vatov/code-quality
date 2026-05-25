import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const strictHelpersPath = fileURLToPath(
  new URL('../../src/rules/effect-strict-helpers.ts', import.meta.url),
);
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

describe('Effect strict helper performance invariants', () => {
  it('uses cheap necessary-token prefilters before expensive source stripping', () => {
    const source = [strictHelpersPath, strictSegmentHelpersPath, strictExternalHelpersPath]
      .map((path): string => readFileSync(path, 'utf-8'))
      .join('\n');

    expect(source).toContain("source.includes('Layer.')");
    expect(source).toContain("source.includes('Effect.forEach')");
    expect(source).toContain("source.includes('HttpClient.')");
    expect(source).toContain("source.includes('Stream.')");
  });

  it('hoists Effect call predicates out of strict CallExpression visitor hot paths', () => {
    const source = strictRulesSource();

    expect(source).toContain('const effectCallPredicate');
    expect(source).not.toContain("new Set(['succeed'])");
  });

  it('uses necessary-call tokens for strict AST rules', () => {
    const source = strictRulesSource();

    expect(source).toContain("name: 'effect-prefer-effect-void',");
    expect(source).toContain("tokens: ['succeed'],");
  });

  it('uses broad identifier tokens for strict environment escape-hatch rules', () => {
    const source = strictRulesSource();

    expect(source).toContain("tokens: ['process'],");
    expect(source).toContain("tokens: ['Date', 'Math'],");
  });

  it('caches local external call segments shared by timeout retry and span rules', () => {
    const source = readFileSync(strictSegmentHelpersPath, 'utf-8');

    expect(source).toContain('localEffectCallSegmentCache');
    expect(source).toContain('enclosingEffectWrapperSegmentCache');
    expect(source).not.toContain('localEffectCallSegmentCache.delete(source)');
    expect(source).not.toContain('enclosingEffectWrapperSegmentCache.delete(source)');
  });

  it('hoists external call scanner patterns out of strict helper hot paths', () => {
    const source = readFileSync(strictExternalHelpersPath, 'utf-8');

    expect(source).toContain('const EXTERNAL_CALL_PATTERN =');
    expect(source).toContain('const IDEMPOTENT_EXTERNAL_CALL_PATTERN =');
    expect(source).not.toContain('const externalCallPattern =');
    expect(source).not.toContain('const idempotentPattern =');
  });

  it('uses an allocation-free pipe operator scanner for external-effect checks', () => {
    const source = readFileSync(strictSegmentHelpersPath, 'utf-8');
    const scannerStart = source.indexOf('const hasTopLevelPipeOperator');
    const scannerEnd = source.indexOf('const hasExternalEffectWithoutTimeout');
    const scannerSource = source.slice(scannerStart, scannerEnd);

    expect(scannerSource).toContain('operatorNeedle');
    expect(scannerSource).not.toContain('new RegExp');
    expect(scannerSource).not.toContain('operatorPattern');
  });
});
