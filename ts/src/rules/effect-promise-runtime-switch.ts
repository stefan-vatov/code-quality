/* -------------------------------------------------------------------------- */
/*        Ordered switch selection for the Effect runtime interpreter.        */
/* -------------------------------------------------------------------------- */

import {
  NORMAL_RUNTIME_RESULT,
  executeRuntimeBranchSequence,
} from './effect-promise-runtime-control-branches';
import { RUNTIME_BREAK, RUNTIME_NORMAL, unknownRuntimeValue } from './effect-promise-runtime-model';
import type {
  RuntimeExecutionContext,
  RuntimeResult,
  RuntimeStatementHost,
} from './effect-promise-runtime-model';
import { childNode, childNodes } from './effect-ast';
import type { ASTNode } from './effect-ast';
import type { RuntimeControlScalar } from './effect-promise-runtime-control-scalars';
import { runtimeControlScalar } from './effect-promise-runtime-control-scalars';

type Scalar = RuntimeControlScalar;

interface SwitchSelection {
  cases: readonly ASTNode[];
  context: RuntimeExecutionContext;
  discriminant: Scalar;
  fallback: number;
  host: RuntimeStatementHost;
  labels: readonly string[];
}

const targetMatches = (result: RuntimeResult, labels: readonly string[]): boolean =>
  result.target === undefined || labels.includes(result.target);

const executeCaseConsequents = (
  selection: SwitchSelection,
  caseNode: ASTNode,
): RuntimeResult | undefined => {
  const { context, host, labels } = selection;
  for (const statement of childNodes(caseNode, 'consequent')) {
    const result = host.statement(statement, context);
    if (result.completion === RUNTIME_BREAK && targetMatches(result, labels)) {
      return NORMAL_RUNTIME_RESULT;
    }
    if (result.completion !== RUNTIME_NORMAL) {
      return result;
    }
  }
  return undefined;
};

const executeConsequents = (selection: SwitchSelection, start: number): RuntimeResult => {
  const { cases } = selection;
  for (let index = start; index < cases.length; index += 1) {
    const caseNode = cases[index];
    if (!caseNode) {
      return NORMAL_RUNTIME_RESULT;
    }
    const result = executeCaseConsequents(selection, caseNode);
    if (result) {
      return result;
    }
  }
  return NORMAL_RUNTIME_RESULT;
};

const sameScalar = (left: Scalar, right: Scalar): boolean =>
  left !== unknownRuntimeValue && right !== unknownRuntimeValue && left === right;

const selectAfterTest = (
  selection: SwitchSelection,
  index: number,
  test: RuntimeResult,
): RuntimeResult => {
  const { context, discriminant, host } = selection;
  const testScalar = runtimeControlScalar(test.value, host, context);
  if (sameScalar(discriminant, testScalar)) {
    return executeConsequents(selection, index);
  }
  if (discriminant !== unknownRuntimeValue && testScalar !== unknownRuntimeValue) {
    return selectFrom(selection, index + 1);
  }
  return executeRuntimeBranchSequence(
    host,
    [
      (): RuntimeResult => executeConsequents(selection, index),
      (): RuntimeResult => selectFrom(selection, index + 1),
    ],
    context,
  );
};

const selectFrom = (selection: SwitchSelection, index: number): RuntimeResult => {
  const { cases, context, fallback, host } = selection;
  if (index >= cases.length) {
    return executeConsequents(selection, fallback);
  }
  const caseNode = cases[index];
  if (!caseNode || !childNode(caseNode, 'test')) {
    return selectFrom(selection, index + 1);
  }
  const test = host.optionalChild(caseNode, 'test', context);
  if (test.completion !== RUNTIME_NORMAL) {
    return test;
  }
  return selectAfterTest(selection, index, test);
};

/**
 * Execute case tests in source order and stop precisely on match or abrupt completion.
 *
 * @internal
 */
export const executeRuntimeSwitch = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  labels: readonly string[],
): RuntimeResult => {
  const discriminantResult = host.optionalChild(node, 'discriminant', context);
  if (discriminantResult.completion !== RUNTIME_NORMAL) {
    return discriminantResult;
  }
  const cases = childNodes(node, 'cases');
  const fallback = cases.findIndex((caseNode): boolean => !childNode(caseNode, 'test'));
  let fallbackStart = fallback;
  if (fallback === -1) {
    fallbackStart = cases.length;
  }
  return selectFrom(
    {
      cases,
      context,
      discriminant: runtimeControlScalar(discriminantResult.value, host, context),
      fallback: fallbackStart,
      host,
      labels,
    },
    0,
  );
};
