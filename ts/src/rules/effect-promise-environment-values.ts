/* -------------------------------------------------------------------------- */
/*         Value forwarding through Promise invocation environments.          */
/* -------------------------------------------------------------------------- */

import type {
  ArgumentValue,
  BoundArgument,
  ExecutionArguments,
  ParameterEnvironments,
} from './effect-promise-environment-types';
import type {
  HelperScope,
  HelperScopes,
  InvocationArguments,
} from './effect-promise-callable-types';
import type { ASTNode } from './effect-ast';
import type { ScopeStack } from './effect-ast-scope';
import { identifierName } from './effect-ast';
import { resolveLexicalValue } from './effect-promise-value-scopes';
import { scopeHasBinding } from './effect-ast-scope';
import { unknownArgument } from './effect-promise-environment-types';
import { unwrappedExpression } from './effect-boundary-ast-shared';

const isShadowed = (name: string, scopes: ScopeStack): boolean => scopeHasBinding(name, scopes);

/**
 * Narrow one abstract value to a concrete bound expression.
 *
 * @internal
 */
export const concreteArgument = (value: ArgumentValue): BoundArgument | undefined => {
  if (value && value !== unknownArgument) {
    return value;
  }
  return undefined;
};

/**
 * Determine whether a value provably selects a JavaScript default.
 *
 * @internal
 */
export const isUndefinedArgument = (value: ArgumentValue): boolean => {
  if (!value || value === unknownArgument) {
    return value === undefined;
  }
  const expression = unwrappedExpression(value.node);
  if (identifierName(expression) === 'undefined') {
    return !isShadowed('undefined', value.scopes);
  }
  return expression?.type === 'UnaryExpression' && Reflect.get(expression, 'operator') === 'void';
};

const isShadowedAfter = (
  name: string,
  marker: HelperScope,
  helperScopes: HelperScopes,
): boolean => {
  for (let index = helperScopes.length - 1; index >= 0; index -= 1) {
    const scope = helperScopes[index];
    if (scope === marker) {
      return false;
    }
    if (scope?.has(name)) {
      return true;
    }
  }
  return true;
};

interface EnvironmentResolution {
  found: boolean;
  value: ArgumentValue;
}

const valueFromEnvironment = (
  name: string,
  helperScopes: HelperScopes,
  environment: ParameterEnvironments[number],
): EnvironmentResolution | undefined => {
  if (
    !isShadowedAfter(name, environment.helperScope, helperScopes) &&
    environment.values.has(name)
  ) {
    return { found: true, value: environment.values.get(name) };
  }
  return undefined;
};

const environmentValue = (
  name: string,
  helperScopes: HelperScopes,
  environments: ParameterEnvironments,
): EnvironmentResolution => {
  for (let index = environments.length - 1; index >= 0; index -= 1) {
    const environment = environments[index];
    if (environment) {
      const resolved = valueFromEnvironment(name, helperScopes, environment);
      if (resolved) {
        return resolved;
      }
    }
  }
  return { found: false, value: undefined };
};

const lexicalValueArgument = (
  name: string,
  expression: ASTNode,
  helperScopes: HelperScopes,
  environments: ParameterEnvironments,
): EnvironmentResolution => {
  const lexical = resolveLexicalValue(name, expression, helperScopes);
  if (!lexical.binding) {
    if (lexical.found) {
      return { found: true, value: unknownArgument };
    }
    return { found: false, value: undefined };
  }
  const { node } = lexical.binding;
  if (!node) {
    return { found: true, value: undefined };
  }
  return {
    found: true,
    value: {
      environments,
      helperScopes: lexical.binding.helperScopes,
      isEvaluatedObject: node.type === 'ObjectExpression',
      node,
      scopes: lexical.binding.scopes,
    },
  };
};

const namedArgument = (
  name: string,
  expression: ASTNode,
  helperScopes: HelperScopes,
  environments: ParameterEnvironments,
): EnvironmentResolution => {
  const environment = environmentValue(name, helperScopes, environments);
  if (environment.found) {
    return environment;
  }
  return lexicalValueArgument(name, expression, helperScopes, environments);
};

const noAlias = Symbol('noAlias');

const nextAliasArgument = (current: BoundArgument): ArgumentValue | typeof noAlias => {
  const expression = unwrappedExpression(current.node);
  const name = identifierName(expression);
  if (!name || !expression) {
    return noAlias;
  }
  const resolved = namedArgument(name, expression, current.helperScopes, current.environments);
  if (!resolved.found) {
    return noAlias;
  }
  return resolved.value;
};

interface AliasStep {
  current?: BoundArgument;
  result?: ArgumentValue;
}

const followAliasStep = (current: BoundArgument, seen: Set<object>): AliasStep => {
  const next = nextAliasArgument(current);
  if (next === noAlias) {
    return { result: current };
  }
  if (!next || next === unknownArgument) {
    return { result: next };
  }
  if (seen.has(next.node)) {
    return { result: unknownArgument };
  }
  seen.add(next.node);
  return { current: next };
};

const followAlias = (initial: BoundArgument): ArgumentValue => {
  const seen = new Set<object>([initial.node]);
  let current = initial;
  while (true) {
    const step = followAliasStep(current, seen);
    if (!step.current) {
      return step.result;
    }
    ({ current } = step);
  }
};

const resolvedAliasArgument = (value: ArgumentValue): ArgumentValue => {
  const current = concreteArgument(value);
  if (!current) {
    return value;
  }
  return followAlias(current);
};

const mutableEnvironment = (
  environment: ParameterEnvironments[number],
): Map<string, ArgumentValue> => environment.values;

/**
 * Write one exact value to the nearest visible execution environment.
 *
 * @internal
 */
export const assignArgument = (
  name: string,
  value: ArgumentValue,
  helperScopes: HelperScopes,
  environments: ParameterEnvironments,
): void => {
  for (let index = environments.length - 1; index >= 0; index -= 1) {
    const environment = environments[index];
    if (
      environment &&
      !isShadowedAfter(name, environment.helperScope, helperScopes) &&
      environment.values.has(name)
    ) {
      mutableEnvironment(environment).set(name, value);
      return;
    }
  }
  const [outermost] = environments;
  if (outermost) {
    mutableEnvironment(outermost).set(name, value);
  }
};

/**
 * Bind an expression at its evaluation site, resolving forwarded parameters.
 *
 * @internal
 */
export const boundArgument = (
  node: ASTNode | undefined,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
  environments: ParameterEnvironments,
): ArgumentValue => {
  if (!node) {
    return undefined;
  }
  const expression = unwrappedExpression(node) ?? node;
  const name = identifierName(expression);
  if (name) {
    const resolved = namedArgument(name, expression, helperScopes, environments);
    if (resolved.found) {
      return resolvedAliasArgument(resolved.value);
    }
  }
  return { environments, helperScopes, node: expression, scopes };
};

/**
 * Resolve raw call arguments through the caller's active environments.
 *
 * @internal
 */
export const executionArguments = (
  invocation: InvocationArguments,
  scopes: ScopeStack,
  helperScopes: HelperScopes,
  environments: ParameterEnvironments,
): ExecutionArguments => {
  const values: ArgumentValue[] = [];
  for (const value of invocation.values) {
    values.push(boundArgument(value, scopes, helperScopes, environments));
  }
  return { isExact: invocation.isExact, values };
};

/**
 * Read one abstract argument by position.
 *
 * @internal
 */
export const argumentAt = (argumentsList: ExecutionArguments, index: number): ArgumentValue => {
  if (index < argumentsList.values.length) {
    return argumentsList.values[index];
  }
  if (argumentsList.isExact) {
    return undefined;
  }
  return unknownArgument;
};
