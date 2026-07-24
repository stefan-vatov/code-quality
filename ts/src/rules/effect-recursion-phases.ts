/* -------------------------------------------------------------------------- */
/*        Imported Effect identities whose callbacks execute eagerly.         */
/* -------------------------------------------------------------------------- */

import { childNode, identifierName } from './effect-ast';
import { effectCallAPIName, isShadowed, unwrappedExpression } from './effect-boundary-ast-shared';
import type { ASTNode } from './effect-ast';
import type { EffectAPIBindings } from './effect-boundary-ast-shared';
import type { ScopeStack } from './effect-ast-scope';
import { effectFunctionAliases } from './effect-rule-aliases';

/**
 * Effect v4 APIs whose function arguments execute during construction.
 *
 * @internal
 */
export type EagerEffectAPI =
  | 'catchEager'
  | 'flatMapEager'
  | 'fnUntracedEager'
  | 'mapEager'
  | 'matchCauseEffectEager';

/**
 * Import identities required by recursion phase analysis.
 *
 * @internal
 */
export interface RecursionPhaseBindings {
  effect: EffectAPIBindings;
  eagerFunctions: ReadonlyMap<string, EagerEffectAPI>;
}

const eagerAPINames: readonly EagerEffectAPI[] = [
  'catchEager',
  'flatMapEager',
  'fnUntracedEager',
  'mapEager',
  'matchCauseEffectEager',
];

const eagerAPIName = (value: string | undefined): EagerEffectAPI | undefined =>
  eagerAPINames.find((APIName): boolean => APIName === value);

const memberAPIName = (
  node: ASTNode,
  bindings: RecursionPhaseBindings,
  scopes: ScopeStack,
): EagerEffectAPI | undefined => {
  const propertyName = effectCallAPIName(node, bindings.effect, scopes);
  return eagerAPIName(propertyName);
};

/**
 * Build exact local identities for the eager v4 Effect APIs.
 *
 * @param source - Complete source used to resolve named import aliases.
 * @param effect - Existing namespace and general Effect bindings.
 * @returns Import identities used by the execution-phase walker.
 * @throws Does not throw.
 * @internal
 */
export const recursionPhaseBindingsFor = (
  source: string,
  effect: EffectAPIBindings,
): RecursionPhaseBindings => {
  const eagerFunctions = new Map<string, EagerEffectAPI>();
  for (const APIName of eagerAPINames) {
    for (const localName of effectFunctionAliases(source, 'Effect', APIName)) {
      eagerFunctions.set(localName, APIName);
    }
  }
  return { eagerFunctions, effect };
};

/**
 * Resolve an eager API call using imported binding identity and lexical scope.
 *
 * @param node - Candidate CallExpression.
 * @param bindings - Exact Effect identities for the source file.
 * @param scopes - Lexical value scopes visible at the call.
 * @returns The canonical eager API name, when verified.
 * @throws Does not throw.
 * @internal
 */
export const eagerEffectAPIName = (
  node: ASTNode,
  bindings: RecursionPhaseBindings,
  scopes: ScopeStack,
): EagerEffectAPI | undefined => {
  if (node.type !== 'CallExpression') {
    return undefined;
  }
  const callee = unwrappedExpression(childNode(node, 'callee'));
  const memberName = memberAPIName(node, bindings, scopes);
  if (memberName) {
    return memberName;
  }
  const directName = identifierName(callee);
  if (!directName || isShadowed(directName, scopes)) {
    return undefined;
  }
  return bindings.eagerFunctions.get(directName);
};
