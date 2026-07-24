/* -------------------------------------------------------------------------- */
/*          Iteration semantics for the Effect runtime interpreter.           */
/* -------------------------------------------------------------------------- */

import {
  NORMAL_RUNTIME_RESULT,
  executeRuntimeBranchSequence,
} from './effect-promise-runtime-control-branches';
import {
  RUNTIME_BREAK,
  RUNTIME_CONTINUE,
  RUNTIME_MAYBE_ABRUPT,
  RUNTIME_NONTERMINATING,
  RUNTIME_NORMAL,
  sameRuntimeSnapshotValues,
  snapshotRuntimeState,
  unknownRuntimeValue,
} from './effect-promise-runtime-model';
import type {
  RuntimeExecutionContext,
  RuntimeObjectRef,
  RuntimeResult,
  RuntimeStatementHost,
  RuntimeValue,
} from './effect-promise-runtime-model';
import {
  applyRuntimeScalarUpdate,
  runtimeControlTruthiness,
} from './effect-promise-runtime-control-scalars';
import { childNode, childNodes } from './effect-ast';
import { runtimeNode, runtimeValue } from './effect-promise-runtime-values';
import type { ASTNode } from './effect-ast';
import { bindCurrentRuntimePattern } from './effect-promise-runtime-control-patterns';
import { runtimeArrayValues } from './effect-promise-runtime-heap';
import { unwrappedExpression } from './effect-boundary-ast-shared';

const MAX_EXACT_ITERATIONS = 64;
const NONTERMINATING_RESULT: RuntimeResult = {
  completion: RUNTIME_NONTERMINATING,
  value: undefined,
};
const MAYBE_ABRUPT_RESULT: RuntimeResult = {
  completion: RUNTIME_MAYBE_ABRUPT,
  value: undefined,
};

interface TestResult {
  known: boolean | undefined;
  result: RuntimeResult;
}

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

const targetMatches = (result: RuntimeResult, labels: readonly string[]): boolean =>
  result.target === undefined || labels.includes(result.target);

const bodyCompletion = (
  result: RuntimeResult,
  labels: readonly string[],
): RuntimeResult | undefined => {
  if (result.completion === RUNTIME_NORMAL) {
    return undefined;
  }
  if (result.completion === RUNTIME_CONTINUE && targetMatches(result, labels)) {
    return undefined;
  }
  if (result.completion === RUNTIME_BREAK && targetMatches(result, labels)) {
    return NORMAL_RUNTIME_RESULT;
  }
  return result;
};

const updateResult = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const update = childNode(node, 'update');
  if (update) {
    const result = host.visit(update, context);
    if (result.completion === RUNTIME_NORMAL) {
      applyRuntimeScalarUpdate(host, update, context);
    }
    return result;
  }
  return NORMAL_RUNTIME_RESULT;
};

const executeIteration = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  labels: readonly string[],
): RuntimeResult | undefined => {
  const body = optionalStatement(host, node, 'body', context);
  const completion = bodyCompletion(body, labels);
  if (completion) {
    return completion;
  }
  const update = updateResult(host, node, context);
  if (update.completion === RUNTIME_NORMAL) {
    return undefined;
  }
  return update;
};

const evaluateTest = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): TestResult => {
  if (!childNode(node, 'test')) {
    return { known: true, result: NORMAL_RUNTIME_RESULT };
  }
  const result = host.optionalChild(node, 'test', context);
  if (result.completion !== RUNTIME_NORMAL) {
    return { known: undefined, result };
  }
  return {
    known: runtimeControlTruthiness(result.value, host, context),
    result,
  };
};

const speculativeIteration = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  labels: readonly string[],
): RuntimeResult => {
  const result = executeIteration(host, node, context, labels);
  return result ?? NORMAL_RUNTIME_RESULT;
};

const unknownIteration = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  labels: readonly string[],
): RuntimeResult =>
  executeRuntimeBranchSequence(
    host,
    [
      (): RuntimeResult => NORMAL_RUNTIME_RESULT,
      (): RuntimeResult => speculativeIteration(host, node, context, labels),
    ],
    context,
  );

const testCompletion = (
  test: TestResult,
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  labels: readonly string[],
): RuntimeResult | undefined => {
  if (test.result.completion !== RUNTIME_NORMAL) {
    return test.result;
  }
  if (test.known === false) {
    return NORMAL_RUNTIME_RESULT;
  }
  if (test.known === undefined) {
    return unknownIteration(host, node, context, labels);
  }
  return undefined;
};

const executeKnownTestIteration = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  labels: readonly string[],
  before: ReturnType<typeof snapshotRuntimeState>,
): RuntimeResult | undefined => {
  const result = executeIteration(host, node, context, labels);
  if (result) {
    return result;
  }
  const after = snapshotRuntimeState(host.state, context.taskScopes);
  if (sameRuntimeSnapshotValues(before, after)) {
    return NONTERMINATING_RESULT;
  }
  return undefined;
};

const testedIteration = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  labels: readonly string[],
): RuntimeResult | undefined => {
  const before = snapshotRuntimeState(host.state, context.taskScopes);
  const test = evaluateTest(host, node, context);
  const completed = testCompletion(test, host, node, context, labels);
  if (completed) {
    return completed;
  }
  return executeKnownTestIteration(host, node, context, labels, before);
};

const repeatTestedLoop = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  labels: readonly string[],
): RuntimeResult => {
  for (let iteration = 0; iteration < MAX_EXACT_ITERATIONS; iteration += 1) {
    const result = testedIteration(host, node, context, labels);
    if (result) {
      return result;
    }
  }
  return MAYBE_ABRUPT_RESULT;
};

const initializeFor = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const initializer = childNode(node, 'init');
  if (!initializer) {
    return NORMAL_RUNTIME_RESULT;
  }
  if (initializer.type === 'VariableDeclaration') {
    return host.statement(initializer, context);
  }
  return host.visit(initializer, context);
};

const testedLoop = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  labels: readonly string[],
): RuntimeResult => {
  if (node.type === 'ForStatement') {
    const initialized = initializeFor(host, node, context);
    if (initialized.completion !== RUNTIME_NORMAL) {
      return initialized;
    }
  }
  if (node.type === 'DoWhileStatement') {
    const first = executeIteration(host, node, context, labels);
    if (first) {
      return first;
    }
  }
  return repeatTestedLoop(host, node, context, labels);
};

const runtimeObject = (value: RuntimeValue): RuntimeObjectRef | undefined => {
  if (value && typeof value !== 'symbol' && 'kind' in value && value.kind === 'object') {
    return value;
  }
  return undefined;
};

const arrayExpressionValues = (
  expression: ASTNode,
  host: RuntimeStatementHost,
  context: RuntimeExecutionContext,
): readonly RuntimeValue[] | undefined => {
  if (expression.type !== 'ArrayExpression') {
    return undefined;
  }
  return childNodes(expression, 'elements').map(
    (element): RuntimeValue => runtimeValue(element, host.valueContext(context)),
  );
};

const stringValues = (expression: ASTNode): readonly RuntimeValue[] | undefined => {
  if (expression.type !== 'Literal') {
    return undefined;
  }
  const value: unknown = Reflect.get(expression, 'value');
  if (typeof value === 'string') {
    return Array.from(value, (): RuntimeValue => unknownRuntimeValue);
  }
  return undefined;
};

const forOfValues = (
  value: RuntimeValue,
  host: RuntimeStatementHost,
  context: RuntimeExecutionContext,
): readonly RuntimeValue[] | undefined => {
  const reference = runtimeObject(value);
  if (reference) {
    return runtimeArrayValues(host.state, reference);
  }
  const expression = unwrappedExpression(runtimeNode(value));
  if (!expression) {
    return undefined;
  }
  return arrayExpressionValues(expression, host, context) ?? stringValues(expression);
};

const heapKeys = (
  reference: RuntimeObjectRef,
  host: RuntimeStatementHost,
): readonly RuntimeValue[] =>
  [...(host.state.heap.get(reference)?.keys() ?? [])]
    .filter((name): boolean => name !== 'length')
    .map((): RuntimeValue => unknownRuntimeValue);

const forInValues = (
  value: RuntimeValue,
  host: RuntimeStatementHost,
): readonly RuntimeValue[] | undefined => {
  const reference = runtimeObject(value);
  if (reference) {
    return heapKeys(reference, host);
  }
  const expression = unwrappedExpression(runtimeNode(value));
  if (expression?.type === 'ObjectExpression') {
    return childNodes(expression, 'properties').map((): RuntimeValue => unknownRuntimeValue);
  }
  if (expression?.type === 'ArrayExpression') {
    return childNodes(expression, 'elements').map((): RuntimeValue => unknownRuntimeValue);
  }
  return undefined;
};

const bindDeclaredIterationValue = (
  host: RuntimeStatementHost,
  declaration: ASTNode,
  value: RuntimeValue,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const declared = host.statement(declaration, context);
  if (declared.completion !== RUNTIME_NORMAL) {
    return declared;
  }
  const [declarator] = childNodes(declaration, 'declarations');
  return bindCurrentRuntimePattern(
    host,
    childNode(declarator ?? declaration, 'id'),
    value,
    context,
  );
};

const bindIterationValue = (
  host: RuntimeStatementHost,
  node: ASTNode,
  value: RuntimeValue,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const left = childNode(node, 'left');
  if (!left) {
    return NORMAL_RUNTIME_RESULT;
  }
  if (left.type === 'VariableDeclaration') {
    return bindDeclaredIterationValue(host, left, value, context);
  }
  return bindCurrentRuntimePattern(host, left, value, context);
};

const collectionIteration = (
  host: RuntimeStatementHost,
  node: ASTNode,
  value: RuntimeValue,
  context: RuntimeExecutionContext,
  labels: readonly string[],
): RuntimeResult | undefined => {
  const binding = bindIterationValue(host, node, value, context);
  if (binding.completion !== RUNTIME_NORMAL) {
    return binding;
  }
  const body = optionalStatement(host, node, 'body', context);
  return bodyCompletion(body, labels);
};

const exactCollectionLoop = (
  host: RuntimeStatementHost,
  node: ASTNode,
  values: readonly RuntimeValue[],
  context: RuntimeExecutionContext,
  labels: readonly string[],
): RuntimeResult => {
  for (const value of values) {
    const result = collectionIteration(host, node, value, context, labels);
    if (result) {
      return result;
    }
  }
  return NORMAL_RUNTIME_RESULT;
};

const unknownCollectionLoop = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  labels: readonly string[],
): RuntimeResult =>
  executeRuntimeBranchSequence(
    host,
    [
      (): RuntimeResult => NORMAL_RUNTIME_RESULT,
      (): RuntimeResult =>
        collectionIteration(host, node, unknownRuntimeValue, context, labels) ??
        NORMAL_RUNTIME_RESULT,
    ],
    context,
  );

const collectionRight = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
): RuntimeResult => {
  const rightNode = childNode(node, 'right');
  const expression = unwrappedExpression(rightNode);
  if (expression?.type === 'ArrayExpression' || expression?.type === 'ObjectExpression') {
    return host.visit(expression, context);
  }
  return host.optionalChild(node, 'right', context);
};

const collectionValues = (
  host: RuntimeStatementHost,
  node: ASTNode,
  value: RuntimeValue,
  context: RuntimeExecutionContext,
): readonly RuntimeValue[] | undefined => {
  if (node.type === 'ForOfStatement') {
    return forOfValues(value, host, context);
  }
  return forInValues(value, host);
};

const collectionLoop = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  labels: readonly string[],
): RuntimeResult => {
  const right = collectionRight(host, node, context);
  if (right.completion !== RUNTIME_NORMAL) {
    return right;
  }
  const values = collectionValues(host, node, right.value, context);
  if (values) {
    return exactCollectionLoop(host, node, values, context, labels);
  }
  return unknownCollectionLoop(host, node, context, labels);
};

/**
 * Execute one loop with exact known tests and conservative unknown cardinality.
 *
 * @internal
 */
export const executeRuntimeLoop = (
  host: RuntimeStatementHost,
  node: ASTNode,
  context: RuntimeExecutionContext,
  labels: readonly string[],
): RuntimeResult => {
  if (node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
    return collectionLoop(host, node, context, labels);
  }
  return testedLoop(host, node, context, labels);
};
