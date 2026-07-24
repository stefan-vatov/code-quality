/* -------------------------------------------------------------------------- */
/*            Abstract values for Promise invocation environments.            */
/* -------------------------------------------------------------------------- */

import type { FunctionBinding, HelperScope, HelperScopes } from './effect-promise-callable-types';
import type { ASTNode } from './effect-ast';
import type { ScopeStack } from './effect-ast-scope';

/**
 * An invocation value whose runtime source cannot be proven.
 *
 * @internal
 */
export const unknownArgument = Symbol('unknownArgument');

/**
 * One concrete expression together with its lexical closure provenance.
 *
 * @internal
 */
export interface BoundArgument {
  environments: ParameterEnvironments;
  helperScopes: HelperScopes;
  isEvaluatedObject?: boolean;
  node: ASTNode;
  scopes: ScopeStack;
}

/**
 * An exact, absent, or unknown runtime argument.
 *
 * @internal
 */
export type ArgumentValue = BoundArgument | undefined | typeof unknownArgument;

/**
 * Invocation arguments after resolving caller parameter forwarding.
 *
 * @internal
 */
export interface ExecutionArguments {
  isExact: boolean;
  values: readonly ArgumentValue[];
}

/**
 * One invoked function's parameter values and lexical helper-scope marker.
 *
 * @internal
 */
export interface ParameterEnvironment {
  helperScope: HelperScope;
  values: Map<string, ArgumentValue>;
}

/**
 * Active lexical invocation environments from outermost to innermost.
 *
 * @internal
 */
export type ParameterEnvironments = readonly ParameterEnvironment[];

/**
 * Parameter preparation needed before executing a function body.
 *
 * @internal
 */
export interface PreparedParameters {
  defaults: readonly ParameterDefault[];
  environments: ParameterEnvironments;
  getters: readonly ParameterGetter[];
  helperScopes: HelperScopes;
}

/**
 * One parameter default expression selected by the current invocation.
 *
 * @internal
 */
export interface ParameterDefault {
  expression: BoundArgument;
  pattern: ASTNode;
}

/**
 * One accessor getter evaluated by parameter destructuring.
 *
 * @internal
 */
export interface ParameterGetter {
  binding: FunctionBinding;
  environments: ParameterEnvironments;
  isAbrupt: boolean;
}

/**
 * Mutable assembly state used only while binding one function header.
 *
 * @internal
 */
export interface ParameterBuild {
  defaults: ParameterDefault[];
  environment: Map<string, ArgumentValue>;
  environments: ParameterEnvironments;
  getters: ParameterGetter[];
  helperScopes: HelperScopes;
  runtimeBindings: Map<string, FunctionBinding | undefined>;
  scopes: ScopeStack;
}
