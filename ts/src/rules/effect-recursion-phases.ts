import { childNode, identifierName } from './effect-ast';
import { effectCallAPIName, isShadowed, unwrappedExpression } from './effect-boundary-ast-shared';
import type { ASTNode } from './effect-ast';
import type { EffectAPIBindings } from './effect-boundary-ast-shared';
import type { ScopeStack } from './effect-ast-scope';
import { effectFunctionAliases } from './effect-rule-aliases';

export type EagerEffectAPI =
  | 'catchEager'
  | 'flatMapEager'
  | 'fnUntracedEager'
  | 'mapEager'
  | 'matchCauseEffectEager';

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
