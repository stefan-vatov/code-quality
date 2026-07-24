/* -------------------------------------------------------------------------- */
/*         Execution engine for Promise-producing Effect.sync paths.          */
/* -------------------------------------------------------------------------- */

import {
  COMPLETION_NORMAL,
  COMPLETION_RETURN,
  COMPLETION_UNSAFE,
  NON_TERMINATING_EVALUATION,
  NORMAL_EVALUATION,
  UNSAFE_EVALUATION,
  normalEvaluation,
} from './effect-promise-completion';
import type {
  ExecutionArguments,
  ParameterEnvironments,
  PreparedParameters,
} from './effect-promise-environments';
import type { FunctionBinding, HelperScopes, Invocation } from './effect-promise-callable-types';
import {
  bodyScopesFor,
  generatorExecution,
  nodeScopesFor,
} from './effect-promise-execution-navigation';
import {
  boundArgument,
  concreteArgument,
  executionArguments,
} from './effect-promise-environment-values';
import {
  callableBinding,
  containerHelperScopes,
  invocationFor,
  memberPropertyName,
} from './effect-promise-callables';
import {
  evaluatePromiseAssignment,
  evaluatePromiseCallOperands,
  evaluatePromiseMember,
} from './effect-promise-node-evaluation';
import { isFunctionNode, unwrappedExpression } from './effect-boundary-ast-shared';
import {
  sameCapturedEnvironments,
  sameExecutionArguments,
} from './effect-promise-execution-values';
import { visitPromiseBlock, visitPromiseIf } from './effect-promise-execution-flow';
import type { ASTNode } from './effect-ast';
import type { InvocationFrame } from './effect-promise-execution-values';
import type { PromiseCallOperands } from './effect-promise-node-evaluation';
import type { PromiseEvaluation } from './effect-promise-completion';
import type { PromiseExecutionState } from './effect-promise-execution-types';
import { PromiseInvocationMemo } from './effect-promise-invocation-memo';
import type { ScopeStack } from './effect-ast-scope';
import { childNode } from './effect-ast';
import { eagerCollectionCallback } from './effect-promise-collections';
import { prepareParameters } from './effect-promise-environments';
import { unknownArgument } from './effect-promise-environment-types';
import { visitPromiseChildren } from './effect-promise-node-children';
import { visitPromiseControlExpression } from './effect-promise-expression-flow';

const GENERATOR_BOUNDARY = 1;
const GENERATOR_CONTINUE = 0;
const isDeferredFunction = (node: ASTNode): boolean => isFunctionNode(node);

class PromiseExecutionEngine {
  readonly state: PromiseExecutionState;

  readonly activeInvocations: InvocationFrame[] = [];

  readonly invocationMemo = new PromiseInvocationMemo();

  constructor(state: PromiseExecutionState) {
    this.state = state;
  }

  visit(
    node: ASTNode,
    scopes: ScopeStack,
    helperScopes: HelperScopes,
    environments: ParameterEnvironments,
  ): PromiseEvaluation {
    const nodeScopes = nodeScopesFor(this.state, node, scopes);
    if (this.state.isBoundary(node, nodeScopes)) {
      return UNSAFE_EVALUATION;
    }
    return this.visitNode(node, nodeScopes, helperScopes, environments);
  }

  visitNode(
    node: ASTNode,
    nodeScopes: ScopeStack,
    helperScopes: HelperScopes,
    environments: ParameterEnvironments,
  ): PromiseEvaluation {
    const direct = this.directNodeValue(node, nodeScopes, helperScopes, environments);
    if (direct) {
      return direct;
    }
    const structural = this.visitStructuredNode(node, nodeScopes, helperScopes, environments);
    if (structural) {
      return structural;
    }
    return this.visitNodeChildren(node, nodeScopes, helperScopes, environments);
  }

  visitNodeChildren(
    node: ASTNode,
    nodeScopes: ScopeStack,
    helperScopes: HelperScopes,
    environments: ParameterEnvironments,
  ): PromiseEvaluation {
    const childHelpers = this.childHelperScopes(node, nodeScopes, helperScopes);
    const children = visitPromiseChildren(this, node, nodeScopes, childHelpers, environments);
    if (children.completion !== COMPLETION_NORMAL) {
      return children;
    }
    return normalEvaluation(boundArgument(node, nodeScopes, childHelpers, environments));
  }

  directNodeValue(
    node: ASTNode,
    scopes: ScopeStack,
    helperScopes: HelperScopes,
    environments: ParameterEnvironments,
  ): PromiseEvaluation | undefined {
    if (isDeferredFunction(node) || node.type === 'Identifier' || node.type === 'Literal') {
      return normalEvaluation(boundArgument(node, scopes, helperScopes, environments));
    }
    return undefined;
  }

  visitStructuredNode(
    node: ASTNode,
    scopes: ScopeStack,
    helperScopes: HelperScopes,
    environments: ParameterEnvironments,
  ): PromiseEvaluation | undefined {
    const control = visitPromiseControlExpression(this, {
      environments,
      helperScopes,
      node,
      scopes,
    });
    if (control) {
      return control;
    }
    if (node.type === 'CallExpression') {
      return this.visitCall(node, scopes, helperScopes, environments);
    }
    if (node.type === 'MemberExpression') {
      return evaluatePromiseMember(this, node, scopes, helperScopes, environments);
    }
    if (node.type === 'AssignmentExpression') {
      return evaluatePromiseAssignment(this, node, scopes, helperScopes, environments);
    }
    return this.visitStatementStructure(node, scopes, helperScopes, environments);
  }

  visitStatementStructure(
    node: ASTNode,
    scopes: ScopeStack,
    helperScopes: HelperScopes,
    environments: ParameterEnvironments,
  ): PromiseEvaluation | undefined {
    const childHelpers = this.childHelperScopes(node, scopes, helperScopes);
    if (node.type === 'BlockStatement') {
      return visitPromiseBlock(this, {
        environments,
        helperScopes: childHelpers,
        inheritedHelperScopes: helperScopes,
        node,
        scopes,
      });
    }
    if (node.type === 'IfStatement') {
      return visitPromiseIf(this, { environments, helperScopes: childHelpers, node, scopes });
    }
    return undefined;
  }

  visitCall(
    call: ASTNode,
    scopes: ScopeStack,
    helperScopes: HelperScopes,
    environments: ParameterEnvironments,
  ): PromiseEvaluation {
    const operands = evaluatePromiseCallOperands(this, call, scopes, helperScopes, environments);
    if (operands.result.completion !== COMPLETION_NORMAL) {
      return operands.result;
    }
    return this.executeCall(call, scopes, helperScopes, environments, operands);
  }

  executeCall(
    call: ASTNode,
    scopes: ScopeStack,
    helperScopes: HelperScopes,
    environments: ParameterEnvironments,
    operands: PromiseCallOperands,
  ): PromiseEvaluation {
    const binding = this.evaluatedCallable(operands, scopes, helperScopes);
    if (binding) {
      return this.execute(binding, operands.argumentsList, environments);
    }
    return this.executeSyntaxCall(call, scopes, helperScopes, environments, operands);
  }

  evaluatedCallable(
    operands: PromiseCallOperands,
    scopes: ScopeStack,
    helperScopes: HelperScopes,
  ): FunctionBinding | undefined {
    const callee = concreteArgument(operands.calleeValue);
    return callableBinding(
      callee?.node,
      callee?.scopes ?? scopes,
      callee?.helperScopes ?? helperScopes,
    );
  }

  executeSyntaxCall(
    call: ASTNode,
    scopes: ScopeStack,
    helperScopes: HelperScopes,
    environments: ParameterEnvironments,
    operands: PromiseCallOperands,
  ): PromiseEvaluation {
    const generator = this.generatorIterationFor(call, scopes, helperScopes);
    if (generator) {
      return this.executeInvocation(generator, scopes, helperScopes, environments, true);
    }
    const invocation = invocationFor(call, scopes, helperScopes);
    if (invocation) {
      const syntaxCallee = unwrappedExpression(childNode(call, 'callee'));
      if (syntaxCallee?.type === 'Identifier') {
        return this.execute(invocation.binding, operands.argumentsList, environments);
      }
      return this.executeInvocation(invocation, scopes, helperScopes, environments, false);
    }
    return this.executeCollectionCallback(call, scopes, helperScopes, environments);
  }

  execute(
    binding: FunctionBinding,
    argumentsList: ExecutionArguments,
    inheritedEnvironments: ParameterEnvironments,
    executeGeneratorBody = false,
  ): PromiseEvaluation {
    const { node } = binding;
    if (Reflect.get(node, 'async') === true && Reflect.get(node, 'generator') !== true) {
      return UNSAFE_EVALUATION;
    }
    if (
      this.hasActiveInvocation(binding, argumentsList, inheritedEnvironments, executeGeneratorBody)
    ) {
      return NON_TERMINATING_EVALUATION;
    }
    if (
      this.invocationMemo.hasUnsafe(
        binding,
        argumentsList,
        inheritedEnvironments,
        executeGeneratorBody,
      )
    ) {
      return UNSAFE_EVALUATION;
    }
    return this.invocationMemo.complete(
      binding,
      argumentsList,
      inheritedEnvironments,
      executeGeneratorBody,
      this.executeActive(binding, argumentsList, inheritedEnvironments, executeGeneratorBody),
    );
  }

  executeActive(
    binding: FunctionBinding,
    argumentsList: ExecutionArguments,
    inheritedEnvironments: ParameterEnvironments,
    executeGeneratorBody: boolean,
  ): PromiseEvaluation {
    const { node } = binding;
    this.activeInvocations.push({
      argumentsList,
      binding,
      environments: inheritedEnvironments,
      executeGeneratorBody,
    });
    const functionScopes = nodeScopesFor(this.state, node, binding.scopes);
    const parameters = prepareParameters(
      binding,
      argumentsList,
      functionScopes,
      inheritedEnvironments,
    );
    const result = this.executePrepared(node, functionScopes, parameters, executeGeneratorBody);
    this.activeInvocations.pop();
    if (result.completion === COMPLETION_RETURN) {
      return normalEvaluation(result.value);
    }
    return result;
  }

  executePrepared(
    node: ASTNode,
    functionScopes: ScopeStack,
    parameters: PreparedParameters,
    executeGeneratorBody: boolean,
  ): PromiseEvaluation {
    const getters = this.executeGetters(parameters);
    if (getters.completion !== COMPLETION_NORMAL) {
      return getters;
    }
    const defaults = this.executeDefaults(parameters);
    if (defaults.completion !== COMPLETION_NORMAL) {
      return defaults;
    }
    return this.executePreparedBody(node, functionScopes, parameters, executeGeneratorBody);
  }

  executePreparedBody(
    node: ASTNode,
    functionScopes: ScopeStack,
    parameters: PreparedParameters,
    executeGeneratorBody: boolean,
  ): PromiseEvaluation {
    const generator = generatorExecution(node, executeGeneratorBody);
    if (generator !== GENERATOR_CONTINUE) {
      if (generator === GENERATOR_BOUNDARY) {
        return UNSAFE_EVALUATION;
      }
      return NORMAL_EVALUATION;
    }
    return this.executeBody(node, functionScopes, parameters);
  }

  executeGetters(parameters: PreparedParameters): PromiseEvaluation {
    for (const getter of parameters.getters) {
      const result = this.execute(
        getter.binding,
        { isExact: true, values: [] },
        getter.environments,
      );
      if (result.completion !== COMPLETION_NORMAL) {
        return result;
      }
    }
    return NORMAL_EVALUATION;
  }

  executeDefaults(parameters: PreparedParameters): PromiseEvaluation {
    for (const selectedDefault of parameters.defaults) {
      if (!this.state.activeDefaults.has(selectedDefault.pattern)) {
        const result = this.executeDefault(selectedDefault.pattern, selectedDefault.expression);
        if (result.completion !== COMPLETION_NORMAL) {
          return result;
        }
      }
    }
    return NORMAL_EVALUATION;
  }

  executeDefault(
    pattern: ASTNode,
    expression: PreparedParameters['defaults'][number]['expression'],
  ): PromiseEvaluation {
    this.state.activeDefaults.add(pattern);
    const result = this.visit(
      expression.node,
      expression.scopes,
      expression.helperScopes,
      expression.environments,
    );
    this.state.activeDefaults.delete(pattern);
    return result;
  }

  executeBody(
    node: ASTNode,
    functionScopes: ScopeStack,
    parameters: PreparedParameters,
  ): PromiseEvaluation {
    const body = childNode(node, 'body');
    if (!body) {
      return NORMAL_EVALUATION;
    }
    const bodyScopes = bodyScopesFor(this.state, functionScopes, node);
    return this.visit(body, bodyScopes, parameters.helperScopes, parameters.environments);
  }

  hasActiveInvocation(
    binding: FunctionBinding,
    argumentsList: ExecutionArguments,
    environments: ParameterEnvironments,
    executeGeneratorBody: boolean,
  ): boolean {
    for (let index = this.activeInvocations.length - 1; index >= 0; index -= 1) {
      const active = this.activeInvocations[index];
      if (
        active?.binding.node === binding.node &&
        active.executeGeneratorBody === executeGeneratorBody &&
        sameExecutionArguments(active.argumentsList, argumentsList) &&
        sameCapturedEnvironments(active.environments, environments)
      ) {
        return true;
      }
    }
    return false;
  }

  executeInvocation(
    invocation: Invocation,
    scopes: ScopeStack,
    helperScopes: HelperScopes,
    environments: ParameterEnvironments,
    executeGeneratorBody: boolean,
  ): PromiseEvaluation {
    const argumentsList = executionArguments(
      invocation.arguments,
      scopes,
      helperScopes,
      environments,
    );
    return this.execute(invocation.binding, argumentsList, environments, executeGeneratorBody);
  }

  executeCollectionCallback(
    call: ASTNode,
    scopes: ScopeStack,
    helperScopes: HelperScopes,
    environments: ParameterEnvironments,
  ): PromiseEvaluation {
    const callback = eagerCollectionCallback(call, scopes, this.state.isNativeGlobal);
    const binding = callableBinding(callback, scopes, helperScopes);
    if (!binding) {
      return normalEvaluation(unknownArgument);
    }
    return this.execute(binding, { isExact: false, values: [] }, environments);
  }

  generatorIterationFor(
    call: ASTNode,
    scopes: ScopeStack,
    helperScopes: HelperScopes,
  ): Invocation | undefined {
    const callee = unwrappedExpression(childNode(call, 'callee'));
    if (callee?.type !== 'MemberExpression' || memberPropertyName(callee) !== 'next') {
      return undefined;
    }
    const iteratorCreation = unwrappedExpression(childNode(callee, 'object'));
    if (iteratorCreation?.type !== 'CallExpression') {
      return undefined;
    }
    const invocation = invocationFor(iteratorCreation, scopes, helperScopes);
    if (invocation && Reflect.get(invocation.binding.node, 'generator') === true) {
      return invocation;
    }
    return undefined;
  }

  childHelperScopes(node: ASTNode, scopes: ScopeStack, helperScopes: HelperScopes): HelperScopes {
    if (node.type === 'BlockStatement') {
      return containerHelperScopes(node, scopes, helperScopes);
    }
    return helperScopes;
  }

  returnedValueIsUnsafe(result: PromiseEvaluation): boolean {
    if (result.completion !== COMPLETION_NORMAL) {
      return result.completion === COMPLETION_UNSAFE;
    }
    const value = concreteArgument(result.value);
    return Boolean(value && this.state.isBoundary(value.node, value.scopes));
  }
}

/**
 * Analyze one Promise execution graph with isolated recursion guards.
 *
 * @internal
 */
export const executePromiseGraph = (
  state: PromiseExecutionState,
  binding: FunctionBinding,
): boolean => {
  const marker = binding.helperScopes[binding.helperScopes.length - 1] ?? new Map();
  const environments: ParameterEnvironments = [{ helperScope: marker, values: new Map() }];
  const engine = new PromiseExecutionEngine(state);
  return engine.returnedValueIsUnsafe(
    engine.execute(binding, { isExact: true, values: [] }, environments),
  );
};
