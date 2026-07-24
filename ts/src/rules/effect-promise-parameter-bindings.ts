/* -------------------------------------------------------------------------- */
/*             Parameter binding for Promise execution analysis.              */
/* -------------------------------------------------------------------------- */

import type {
  ArgumentValue,
  ExecutionArguments,
  ParameterBuild,
  ParameterEnvironments,
  PreparedParameters,
} from './effect-promise-environment-types';
import type { FunctionBinding, HelperScopes } from './effect-promise-callable-types';
import {
  argumentAt,
  boundArgument,
  concreteArgument,
  isUndefinedArgument,
} from './effect-promise-environment-values';
import { arrayValues, objectPropertyRead } from './effect-promise-environment-projections';
import { childNode, childNodes, identifierName } from './effect-ast';
import { declaredPromisePropertyName, rawPromiseNodes } from './effect-promise-ast-values';
import { functionHeaderScopes, resolvedHelper } from './effect-promise-callables';
import type { ASTNode } from './effect-ast';
import type { ScopeStack } from './effect-ast-scope';
import { isFunctionNode } from './effect-boundary-ast-shared';
import { unknownArgument } from './effect-promise-environment-types';

const bindAssignmentPattern = (
  pattern: ASTNode,
  value: ArgumentValue,
  build: ParameterBuild,
): void => {
  let effectiveValue = value;
  if (isUndefinedArgument(value)) {
    const initializer = boundArgument(
      childNode(pattern, 'right'),
      build.scopes,
      build.helperScopes,
      build.environments,
    );
    const concrete = concreteArgument(initializer);
    if (concrete) {
      build.defaults.push({ expression: concrete, pattern });
    }
    effectiveValue = initializer;
  }
  bindPattern(childNode(pattern, 'left'), effectiveValue, build);
};

const bindObjectProperty = (
  property: ASTNode,
  value: ArgumentValue,
  build: ParameterBuild,
): void => {
  if (property.type !== 'Property') {
    return;
  }
  const propertyKey = declaredPromisePropertyName(property);
  let propertyValue: ArgumentValue = unknownArgument;
  if (propertyKey) {
    const read = objectPropertyRead(value, propertyKey);
    propertyValue = read.value;
    if (read.getter) {
      build.getters.push(read.getter);
    }
  }
  bindPattern(childNode(property, 'value'), propertyValue, build);
};

const bindObjectPattern = (pattern: ASTNode, value: ArgumentValue, build: ParameterBuild): void => {
  for (const property of childNodes(pattern, 'properties')) {
    bindObjectProperty(property, value, build);
  }
};

const arrayPatternValues = (value: ArgumentValue): ExecutionArguments => {
  const array = concreteArgument(value);
  if (array?.node.type === 'ArrayExpression') {
    return arrayValues(array);
  }
  return { isExact: false, values: [] };
};

const bindArrayPattern = (pattern: ASTNode, value: ArgumentValue, build: ParameterBuild): void => {
  const values = arrayPatternValues(value);
  const patterns = rawPromiseNodes(pattern, 'elements');
  for (let index = 0; index < patterns.length; index += 1) {
    bindPattern(patterns[index], argumentAt(values, index), build);
  }
};

const wrappedChildKey = (pattern: ASTNode): string | undefined => {
  if (pattern.type === 'RestElement') {
    return 'argument';
  }
  if (pattern.type === 'TSParameterProperty') {
    return 'parameter';
  }
  return undefined;
};

const bindWrappedPattern = (
  pattern: ASTNode,
  value: ArgumentValue,
  build: ParameterBuild,
): boolean => {
  if (pattern.type === 'AssignmentPattern') {
    bindAssignmentPattern(pattern, value, build);
    return true;
  }
  const childKey = wrappedChildKey(pattern);
  if (!childKey) {
    return false;
  }
  bindPattern(childNode(pattern, childKey), value, build);
  return true;
};

const bindNamedPattern = (
  pattern: ASTNode,
  value: ArgumentValue,
  build: ParameterBuild,
): boolean => {
  const name = identifierName(pattern);
  if (!name) {
    return false;
  }
  build.environment.set(name, value);
  return true;
};

/**
 * Inputs used to record one evaluated local declaration.
 *
 * @internal
 */
export interface LocalDeclaratorContext {
  environments: ParameterEnvironments;
  evaluatedValue?: ArgumentValue;
  helperScopes: HelperScopes;
  scopes: ScopeStack;
}

/**
 * Record one evaluated local declarator in a block-local value environment.
 *
 * @internal
 */
export const bindLocalDeclarator = (
  declarator: ASTNode,
  environment: Map<string, ArgumentValue>,
  context: LocalDeclaratorContext,
): void => {
  const name = identifierName(childNode(declarator, 'id'));
  if (name) {
    environment.set(
      name,
      context.evaluatedValue ??
        boundArgument(
          childNode(declarator, 'init'),
          context.scopes,
          context.helperScopes,
          context.environments,
        ),
    );
  }
};

const bindPattern = (
  pattern: ASTNode | undefined,
  value: ArgumentValue,
  build: ParameterBuild,
): void => {
  if (!pattern || bindNamedPattern(pattern, value, build)) {
    return;
  }
  if (bindWrappedPattern(pattern, value, build)) {
    return;
  }
  if (pattern.type === 'ObjectPattern') {
    bindObjectPattern(pattern, value, build);
    return;
  }
  bindArrayPattern(pattern, value, build);
};

const callableBinding = (value: ArgumentValue): FunctionBinding | undefined => {
  const concrete = concreteArgument(value);
  if (!concrete) {
    return undefined;
  }
  if (isFunctionNode(concrete.node)) {
    return {
      helperScopes: concrete.helperScopes,
      node: concrete.node,
      scopes: concrete.scopes,
    };
  }
  return resolvedHelper(concrete.node, concrete.helperScopes);
};

const bindParameterCallables = (
  bindings: Map<string, FunctionBinding | undefined>,
  environment: ReadonlyMap<string, ArgumentValue>,
): void => {
  for (const [name, value] of environment) {
    bindings.set(name, callableBinding(value));
  }
};

const bindRESTParameter = (
  restPattern: ASTNode | undefined,
  argumentsList: ExecutionArguments,
  start: number,
  build: ParameterBuild,
): void => {
  if (restPattern?.type !== 'ArrayPattern') {
    bindPattern(restPattern, unknownArgument, build);
    return;
  }
  const patterns = rawPromiseNodes(restPattern, 'elements');
  for (let index = 0; index < patterns.length; index += 1) {
    bindPattern(patterns[index], argumentAt(argumentsList, start + index), build);
  }
};

const bindParameter = (
  parameter: ASTNode | undefined,
  argumentsList: ExecutionArguments,
  index: number,
  build: ParameterBuild,
): void => {
  if (parameter?.type === 'RestElement') {
    bindRESTParameter(childNode(parameter, 'argument'), argumentsList, index, build);
    return;
  }
  bindPattern(parameter, argumentAt(argumentsList, index), build);
};

const bindParameters = (
  parameters: readonly ASTNode[],
  argumentsList: ExecutionArguments,
  build: ParameterBuild,
): void => {
  for (let index = 0; index < parameters.length; index += 1) {
    bindParameter(parameters[index], argumentsList, index, build);
  }
};

const parameterBuild = (
  binding: FunctionBinding,
  functionScopes: ScopeStack,
  inheritedEnvironments: ParameterEnvironments,
): ParameterBuild => {
  const headerScopes = functionHeaderScopes(binding.node, binding);
  const runtimeBindings = new Map<string, FunctionBinding | undefined>();
  const environment = new Map<string, ArgumentValue>();
  const helperScopes: HelperScopes = [...headerScopes, runtimeBindings];
  const environments: ParameterEnvironments = [
    ...inheritedEnvironments,
    { helperScope: runtimeBindings, values: environment },
  ];
  return {
    defaults: [],
    environment,
    environments,
    getters: [],
    helperScopes,
    runtimeBindings,
    scopes: functionScopes,
  };
};

/**
 * Build invocation-local values and callable bindings for one function call.
 *
 * @internal
 */
export const prepareParameters = (
  binding: FunctionBinding,
  argumentsList: ExecutionArguments,
  functionScopes: ScopeStack,
  inheritedEnvironments: ParameterEnvironments,
): PreparedParameters => {
  const build = parameterBuild(binding, functionScopes, inheritedEnvironments);
  bindParameters(childNodes(binding.node, 'params'), argumentsList, build);
  bindParameterCallables(build.runtimeBindings, build.environment);
  return {
    defaults: build.defaults,
    environments: build.environments,
    getters: build.getters,
    helperScopes: build.helperScopes,
  };
};
