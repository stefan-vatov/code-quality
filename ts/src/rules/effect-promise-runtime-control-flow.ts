/* -------------------------------------------------------------------------- */
/*      Control statements for the Effect runtime abstract interpreter.       */
/* -------------------------------------------------------------------------- */

import {
  NORMAL_RUNTIME_RESULT,
  executeRuntimeBranchSequence,
} from './effect-promise-runtime-control-branches';
import { RUNTIME_BREAK, RUNTIME_NORMAL } from './effect-promise-runtime-model';
import type {
  RuntimeExecutionContext,
  RuntimeResult,
  RuntimeStatementHost,
} from './effect-promise-runtime-model';
import { childNode, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';
import { executeRuntimeLoop } from './effect-promise-runtime-loops';
import { executeRuntimeSwitch } from './effect-promise-runtime-switch';
import { executeRuntimeTry } from './effect-promise-runtime-try';
import { runtimeTruthiness } from './effect-promise-runtime-values';

const optionalStatement = (
  host: RuntimeStatementHost,
  node: ASTNode,
  key: string,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const statement = childNode(node, key);
  if (statement) {
    return host.statement(statement, context);
  }
  return NORMAL_RUNTIME_RESULT;
};

const ifStatement = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const test = host.optionalChild(node, 'test', context);
  if (test.completion !== RUNTIME_NORMAL) {
    return test;
  }
  const known = runtimeTruthiness(test.value, host.valueContext(context));
  if (known === true) {
    return optionalStatement(host, node, 'consequent', context);
  }
  if (known === false) {
    return optionalStatement(host, node, 'alternate', context);
  }
  return executeRuntimeBranchSequence(
    host,
    [
      (): RuntimeResult => optionalStatement(host, node, 'consequent', context),
      (): RuntimeResult => optionalStatement(host, node, 'alternate', context),
    ],
    context,
  );
};

const isLoop = (node: ASTNode): boolean =>
  node.type === 'DoWhileStatement' ||
  node.type === 'ForInStatement' ||
  node.type === 'ForOfStatement' ||
  node.type === 'ForStatement' ||
  node.type === 'WhileStatement';

const labeledTarget = (
  node: ASTNode,
): { labels: readonly string[]; statement: ASTNode | undefined } => {
  const labels: string[] = [];
  let statement: ASTNode | undefined = node;
  while (statement?.type === 'LabeledStatement') {
    const label = identifierName(childNode(statement, 'label'));
    if (label) {
      labels.push(label);
    }
    statement = childNode(statement, 'body');
  }
  return { labels, statement };
};

const consumesLabeledBreak = (result: RuntimeResult, labels: readonly string[]): boolean =>
  result.completion === RUNTIME_BREAK &&
  result.target !== undefined &&
  labels.includes(result.target);

const executeLabeled = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const { labels, statement } = labeledTarget(node);
  if (!statement) {
    return NORMAL_RUNTIME_RESULT;
  }
  const control = executeControl(host, statement, context, labels);
  const result = control ?? host.statement(statement, context);
  if (consumesLabeledBreak(result, labels)) {
    return NORMAL_RUNTIME_RESULT;
  }
  return result;
};

const executeOtherControl = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  labels: readonly string[],
): RuntimeResult | undefined => {
  if (node.type === 'SwitchStatement') {
    return executeRuntimeSwitch(host, node, context, labels);
  }
  if (node.type === 'TryStatement') {
    return executeRuntimeTry(host, node, context);
  }
  if (node.type === 'LabeledStatement') {
    return executeLabeled(host, node, context);
  }
  return undefined;
};

const executeControl = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  labels: readonly string[],
): RuntimeResult | undefined => {
  if (node.type === 'IfStatement') {
    return ifStatement(host, node, context);
  }
  if (isLoop(node)) {
    return executeRuntimeLoop(host, node, context, labels);
  }
  return executeOtherControl(host, node, context, labels);
};

/**
 * Execute a recognized control statement, or decline non-control nodes.
 *
 * @internal
 */
export const executeRuntimeControlStatement = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult | undefined => executeControl(host, node, context, []);
