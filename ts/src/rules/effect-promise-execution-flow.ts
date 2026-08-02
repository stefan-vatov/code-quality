/* -------------------------------------------------------------------------- */
/*        Exact statement flow for Promise-producing helper execution.        */
/* -------------------------------------------------------------------------- */

import type { ArgumentValue, ParameterEnvironments } from './effect-promise-environment-types';
import {
  COMPLETION_NORMAL,
  NORMAL_EVALUATION,
  THROW_EVALUATION,
  joinPromiseEnvironments,
  joinPromiseEvaluations,
  restorePromiseEnvironments,
  returnEvaluation,
  snapshotPromiseEnvironments,
} from './effect-promise-completion';
import { childNode, childNodes } from './effect-ast';
import type { ASTNode } from './effect-ast';
import type { HelperScopes } from './effect-promise-callable-types';
import type { PromiseEvaluation } from './effect-promise-completion';
import type { PromiseExecutionState } from './effect-promise-execution-types';
import type { ScopeStack } from './effect-ast-scope';
import { bindLocalDeclarator } from './effect-promise-parameter-bindings';
import { knownArgumentBooleanValue } from './effect-promise-execution-values';
import { nodeScopesFor } from './effect-promise-execution-navigation';

/**
 * Engine capabilities used by the isolated statement interpreter.
 *
 * @internal
 */
export interface PromiseFlowVisitor {
  readonly state: PromiseExecutionState;
  childHelperScopes: (
    node: ASTNode,
    scopes: ScopeStack,
    helperScopes: HelperScopes,
  ) => HelperScopes;
  visit: (
    node: ASTNode,
    scopes: ScopeStack,
    helperScopes: HelperScopes,
    environments: ParameterEnvironments,
  ) => PromiseEvaluation;
}

/**
 * Common exact-flow inputs for one statement.
 *
 * @internal
 */
export interface PromiseFlowInput {
  environments: ParameterEnvironments;
  helperScopes: HelperScopes;
  node: ASTNode;
  scopes: ScopeStack;
}

/**
 * Block inputs including the helper scope inherited before declarations.
 *
 * @internal
 */
export interface PromiseBlockFlowInput extends PromiseFlowInput {
  inheritedHelperScopes: HelperScopes;
}

interface BlockContext {
  environments: ParameterEnvironments;
  helperScopes: HelperScopes;
  values?: Map<string, ArgumentValue>;
}

interface StatementContext extends PromiseFlowInput {
  localValues?: Map<string, ArgumentValue>;
}

const blockContext = (
  blockHelpers: HelperScopes,
  inheritedHelpers: HelperScopes,
  environments: ParameterEnvironments,
  hasLocalDeclarations: boolean,
): BlockContext => {
  if (!hasLocalDeclarations) {
    return { environments, helperScopes: blockHelpers };
  }
  const values = new Map<string, ArgumentValue>();
  let helperScopes = blockHelpers;
  let marker = blockHelpers[blockHelpers.length - 1];
  if (marker === inheritedHelpers[inheritedHelpers.length - 1]) {
    marker = new Map();
    helperScopes = [...blockHelpers, marker];
  }
  return {
    environments: [...environments, { helperScope: marker, values }],
    helperScopes,
    values,
  };
};

const visitReturn = (visitor: PromiseFlowVisitor, context: StatementContext): PromiseEvaluation => {
  const argument = childNode(context.node, 'argument');
  if (!argument) {
    return returnEvaluation(undefined);
  }
  const result = visitor.visit(
    argument,
    context.scopes,
    context.helperScopes,
    context.environments,
  );
  if (result.completion !== COMPLETION_NORMAL) {
    return result;
  }
  return returnEvaluation(result.value);
};

const visitThrow = (visitor: PromiseFlowVisitor, context: StatementContext): PromiseEvaluation => {
  const argument = childNode(context.node, 'argument');
  if (!argument) {
    return THROW_EVALUATION;
  }
  const result = visitor.visit(
    argument,
    context.scopes,
    context.helperScopes,
    context.environments,
  );
  if (result.completion !== COMPLETION_NORMAL) {
    return result;
  }
  return THROW_EVALUATION;
};

const visitNestedBlock = (
  visitor: PromiseFlowVisitor,
  context: StatementContext,
): PromiseEvaluation => {
  const nodeScopes = nodeScopesFor(visitor.state, context.node, context.scopes);
  const childHelpers = visitor.childHelperScopes(context.node, nodeScopes, context.helperScopes);
  return visitPromiseBlock(visitor, {
    environments: context.environments,
    helperScopes: childHelpers,
    inheritedHelperScopes: context.helperScopes,
    node: context.node,
    scopes: nodeScopes,
  });
};

const visitVariableDeclaration = (
  visitor: PromiseFlowVisitor,
  context: StatementContext,
): PromiseEvaluation => {
  const { localValues } = context;
  if (!localValues) {
    return NORMAL_EVALUATION;
  }
  for (const declarator of childNodes(context.node, 'declarations')) {
    const result = visitLocalDeclarator(visitor, context, localValues, declarator);
    if (result.completion !== COMPLETION_NORMAL) {
      return result;
    }
  }
  return NORMAL_EVALUATION;
};

const visitLocalDeclarator = (
  visitor: PromiseFlowVisitor,
  context: StatementContext,
  localValues: Map<string, ArgumentValue>,
  declarator: ASTNode,
): PromiseEvaluation => {
  const initializer = childNode(declarator, 'init');
  let value: ArgumentValue = undefined;
  if (initializer) {
    const result = visitor.visit(
      initializer,
      context.scopes,
      context.helperScopes,
      context.environments,
    );
    if (result.completion !== COMPLETION_NORMAL) {
      return result;
    }
    ({ value } = result);
  }
  bindLocalDeclarator(declarator, localValues, {
    environments: context.environments,
    evaluatedValue: value,
    helperScopes: context.helperScopes,
    scopes: context.scopes,
  });
  return NORMAL_EVALUATION;
};

const visitKnownBranch = (
  visitor: PromiseFlowVisitor,
  context: StatementContext,
  known: boolean,
): PromiseEvaluation => {
  let key = 'alternate';
  if (known) {
    key = 'consequent';
  }
  const selected = childNode(context.node, key);
  if (!selected) {
    return NORMAL_EVALUATION;
  }
  return visitStatement(visitor, { ...context, node: selected });
};

const visitBranch = (
  visitor: PromiseFlowVisitor,
  context: StatementContext,
  branch: ASTNode | undefined,
): PromiseEvaluation => {
  if (!branch) {
    return NORMAL_EVALUATION;
  }
  return visitStatement(visitor, { ...context, node: branch });
};

const visitUnknownBranches = (
  visitor: PromiseFlowVisitor,
  context: StatementContext,
): PromiseEvaluation => {
  const baseline = snapshotPromiseEnvironments(context.environments);
  const consequent = visitBranch(visitor, context, childNode(context.node, 'consequent'));
  const consequentValues = snapshotPromiseEnvironments(context.environments);
  restorePromiseEnvironments(context.environments, baseline);
  const alternateNode = childNode(context.node, 'alternate');
  const alternate = visitBranch(visitor, context, alternateNode);
  const alternateValues = snapshotPromiseEnvironments(context.environments);
  mergeUnknownEnvironments(
    context.environments,
    baseline,
    consequentValues,
    alternateValues,
    Boolean(alternateNode),
  );
  return joinPromiseEvaluations(consequent, alternate);
};

const mergeUnknownEnvironments = (
  environments: ParameterEnvironments,
  baseline: ReturnType<typeof snapshotPromiseEnvironments>,
  consequent: ReturnType<typeof snapshotPromiseEnvironments>,
  alternate: ReturnType<typeof snapshotPromiseEnvironments>,
  hasAlternate: boolean,
): void => {
  if (hasAlternate) {
    joinPromiseEnvironments(environments, consequent, alternate);
  } else {
    restorePromiseEnvironments(environments, baseline);
  }
};

const structuralStatementFlow = (
  visitor: PromiseFlowVisitor,
  context: StatementContext,
): PromiseEvaluation | undefined => {
  switch (context.node.type) {
    case 'ReturnStatement': {
      return visitReturn(visitor, context);
    }
    case 'ThrowStatement': {
      return visitThrow(visitor, context);
    }
    case 'IfStatement': {
      return visitPromiseIf(visitor, context);
    }
    case 'BlockStatement': {
      return visitNestedBlock(visitor, context);
    }
    case 'VariableDeclaration': {
      return visitVariableDeclaration(visitor, context);
    }
    default: {
      return undefined;
    }
  }
};

const visitStatement = (
  visitor: PromiseFlowVisitor,
  context: StatementContext,
): PromiseEvaluation => {
  const structural = structuralStatementFlow(visitor, context);
  if (structural) {
    return structural;
  }
  return visitor.visit(context.node, context.scopes, context.helperScopes, context.environments);
};

/**
 * Execute one block in source order until it exits or reaches a boundary.
 *
 * @internal
 */
export const visitPromiseBlock = (
  visitor: PromiseFlowVisitor,
  input: PromiseBlockFlowInput,
): PromiseEvaluation => {
  const statements = childNodes(input.node, 'body');
  const context = blockContext(
    input.helperScopes,
    input.inheritedHelperScopes,
    input.environments,
    statements.some((statement): boolean => statement.type === 'VariableDeclaration'),
  );
  for (const statement of statements) {
    const result = visitStatement(visitor, {
      environments: context.environments,
      helperScopes: context.helperScopes,
      localValues: context.values,
      node: statement,
      scopes: input.scopes,
    });
    if (result.completion !== COMPLETION_NORMAL) {
      return result;
    }
  }
  return NORMAL_EVALUATION;
};

/**
 * Execute a provably selected branch or conservatively visit both branches.
 *
 * @internal
 */
export const visitPromiseIf = (
  visitor: PromiseFlowVisitor,
  input: PromiseFlowInput,
): PromiseEvaluation => {
  const test = childNode(input.node, 'test');
  let testResult = NORMAL_EVALUATION;
  if (test) {
    testResult = visitor.visit(test, input.scopes, input.helperScopes, input.environments);
    if (testResult.completion !== COMPLETION_NORMAL) {
      return testResult;
    }
  }
  const known = knownArgumentBooleanValue(testResult.value, input.scopes);
  if (known !== undefined) {
    return visitKnownBranch(visitor, input, known);
  }
  return visitUnknownBranches(visitor, input);
};
