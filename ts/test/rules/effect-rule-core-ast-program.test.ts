/* -------------------------------------------------------------------------- */
/*       Contracts for composing AST Program visitors with core rules.        */
/* -------------------------------------------------------------------------- */
import {
  type Context,
  type RuleSpec,
  type VisitorMap,
  makeRules,
} from '../../src/rules/effect-rule-core';
import type { ASTNode } from '../../src/rules/effect-ast';
import { describe, expect, it, vi } from 'vitest';
import { effectDiagnosticMessage } from '../../src/rules/diagnostic-guidance';

interface Report {
  message: string;
  node: ASTNode;
}

interface ContextFixture {
  context: Context;
  reports: Report[];
}

const parsedProgram = {
  body: [{ type: 'ExpressionStatement' }],
  type: 'Program',
};

const syntheticProgram = { type: 'Program' };

const makeContext = (source: string, reports: Report[] = []): ContextFixture => ({
  context: {
    report(descriptor): void {
      reports.push({ message: descriptor.message, node: descriptor.node });
    },
    sourceCode: { text: source },
  },
  reports,
});

const ruleFrom = (spec: RuleSpec) => {
  const rules = makeRules([spec]);
  const rule = rules[spec.name];
  expect(rule).toBeDefined();
  return rule;
};

describe('Effect rule core AST Program composition', (): void => {
  it('invokes the AST Program visitor exactly once for a parsed Program', (): void => {
    const astProgram = vi.fn();
    const sourceFallback = vi.fn((): boolean => true);
    const { context } = makeContext('Effect.succeed(1)');
    const rule = ruleFrom({
      ast: (): VisitorMap => ({ Program: astProgram }),
      check: sourceFallback,
      message: 'Inspect this Program.',
      name: 'effect-program-composition',
      tokens: ['Effect'],
    });

    rule?.create(context).Program(parsedProgram);

    expect(astProgram).toHaveBeenCalledOnce();
    expect(astProgram).toHaveBeenCalledWith(parsedProgram);
    expect(sourceFallback).not.toHaveBeenCalled();
  });

  it('keeps non-Program AST visitors intact while composing Program', (): void => {
    const astProgram = vi.fn();
    const callExpression = vi.fn();
    const { context } = makeContext('Effect.succeed(1)');
    const rule = ruleFrom({
      ast: (): VisitorMap => ({
        CallExpression: callExpression,
        Program: astProgram,
      }),
      message: 'Inspect both visitors.',
      name: 'effect-visitor-composition',
      tokens: ['Effect'],
    });
    const visitors = rule?.create(context);
    const callNode = { type: 'CallExpression' };

    visitors?.Program(parsedProgram);
    visitors?.CallExpression?.(callNode);

    expect(astProgram).toHaveBeenCalledOnce();
    expect(callExpression).toHaveBeenCalledOnce();
    expect(callExpression).toHaveBeenCalledWith(callNode);
  });

  it('does not create or invoke AST visitors when token gating skips the rule', (): void => {
    const astFactory = vi.fn(
      (): VisitorMap => ({
        Program: vi.fn(),
      }),
    );
    const sourceFallback = vi.fn((): boolean => true);
    const { context, reports } = makeContext('const value = 1');
    const rule = ruleFrom({
      ast: astFactory,
      check: sourceFallback,
      message: 'This rule is gated.',
      name: 'effect-token-gated-program',
      tokens: ['Effect'],
    });
    const visitors = rule?.create(context);

    visitors?.Program(parsedProgram);

    expect(astFactory).not.toHaveBeenCalled();
    expect(sourceFallback).not.toHaveBeenCalled();
    expect(reports).toEqual([]);
  });

  it('invokes the AST Program visitor before the synthetic Program source fallback', (): void => {
    const calls: string[] = [];
    const { context, reports } = makeContext('Effect.succeed(1)');
    const rule = ruleFrom({
      ast: (): VisitorMap => ({
        Program(): void {
          calls.push('ast');
        },
      }),
      check(): boolean {
        calls.push('fallback');
        return true;
      },
      message: 'Synthetic fallback finding.',
      name: 'effect-synthetic-program-fallback',
      tokens: ['Effect'],
    });

    rule?.create(context).Program(syntheticProgram);

    expect(calls).toEqual(['ast', 'fallback']);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.node).toBe(syntheticProgram);
  });

  it('wraps reports from an AST Program visitor with rule guidance', (): void => {
    const { context, reports } = makeContext('Effect.succeed(1)');
    const astSummary = 'AST Program finding.';
    const ruleName = 'effect-program-guidance';
    const rule = ruleFrom({
      ast: (astContext): VisitorMap => ({
        Program(node): void {
          astContext.report({ message: astSummary, node });
        },
      }),
      message: 'Core rule summary.',
      name: ruleName,
      tokens: ['Effect'],
    });

    rule?.create(context).Program(parsedProgram);

    expect(reports).toEqual([
      {
        message: effectDiagnosticMessage(ruleName, astSummary),
        node: parsedProgram,
      },
    ]);
  });
});
