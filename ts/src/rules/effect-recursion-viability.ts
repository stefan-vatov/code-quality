/* -------------------------------------------------------------------------- */
/*        Construction-time viability for Effect v4 eager combinators.        */
/* -------------------------------------------------------------------------- */

import type { EagerEffectAPI, RecursionPhaseBindings } from './effect-recursion-phases';
import { Predicate } from 'effect';
import { childNode, childNodes, identifierName } from './effect-ast';
import { effectCallAPIName, isShadowed, unwrappedExpression } from './effect-boundary-ast-shared';
import type { ASTNode } from './effect-ast';
import type { ScopeStack } from './effect-ast-scope';
import { eagerEffectAPIName } from './effect-recursion-phases';
import { effectFunctionAliases } from './effect-rule-aliases';

/**
 * Statically known construction-time state of an Effect expression.
 *
 * @internal
 */
export type EffectResolution = 'failure' | 'pending' | 'success' | 'unknown';

/**
 * Exact named imports needed by the construction-time classifier.
 *
 * @internal
 */
export interface EffectResolutionBindings {
  delayFunctions: ReadonlySet<string>;
  failureFunctions: ReadonlyMap<string, 'die' | 'fail' | 'failCause'>;
  phase: RecursionPhaseBindings;
}

/**
 * Canonical eager call shape after normalizing data-first and data-last forms.
 *
 * @internal
 */
export interface EagerEffectInvocation {
  APIName: EagerEffectAPI;
  callback?: ASTNode;
  input?: ASTNode;
}

const directInvocation = (node: ASTNode, APIName: EagerEffectAPI): EagerEffectInvocation => {
  if (APIName === 'fnUntracedEager') {
    return { APIName };
  }
  const [input, callback] = childNodes(node, 'arguments');
  if (!callback) {
    return { APIName };
  }
  return { APIName, callback, input };
};

const onlyArgument = (node: ASTNode): ASTNode | undefined => {
  const argumentsValue = childNodes(node, 'arguments');
  if (argumentsValue.length === 1) {
    return argumentsValue[0];
  }
  return undefined;
};

const curriedAPIName = (
  call: ASTNode,
  bindings: EffectResolutionBindings,
  scopes: ScopeStack,
): EagerEffectAPI | undefined => {
  const APIName = eagerEffectAPIName(call, bindings.phase, scopes);
  if (APIName === 'fnUntracedEager') {
    return undefined;
  }
  return APIName;
};

const curriedArguments = (
  node: ASTNode,
  innerCall: ASTNode,
): Pick<EagerEffectInvocation, 'callback' | 'input'> | undefined => {
  const callback = onlyArgument(innerCall);
  const [input] = childNodes(node, 'arguments');
  if (!callback || !input) {
    return undefined;
  }
  return { callback, input };
};

const curriedInvocation = (
  node: ASTNode,
  bindings: EffectResolutionBindings,
  scopes: ScopeStack,
): EagerEffectInvocation | undefined => {
  const innerCall = unwrappedExpression(childNode(node, 'callee'));
  if (innerCall?.type !== 'CallExpression') {
    return undefined;
  }
  const APIName = curriedAPIName(innerCall, bindings, scopes);
  if (!APIName) {
    return undefined;
  }
  const argumentsValue = curriedArguments(node, innerCall);
  if (!argumentsValue) {
    return undefined;
  }
  return { APIName, ...argumentsValue };
};

/**
 * Build exact named-import identities used by resolution classification.
 *
 * @internal
 */
export const effectResolutionBindingsFor = (
  source: string,
  phase: RecursionPhaseBindings,
): EffectResolutionBindings => {
  const failureFunctions = new Map<string, 'die' | 'fail' | 'failCause'>();
  for (const APIName of ['die', 'fail', 'failCause'] as const) {
    for (const localName of effectFunctionAliases(source, 'Effect', APIName)) {
      failureFunctions.set(localName, APIName);
    }
  }
  return {
    delayFunctions: new Set(effectFunctionAliases(source, 'Effect', 'delay')),
    failureFunctions,
    phase,
  };
};

const directCanonicalName = (
  node: ASTNode,
  bindings: EffectResolutionBindings,
  scopes: ScopeStack,
): string | undefined => {
  const callee = unwrappedExpression(childNode(node, 'callee'));
  const name = identifierName(callee);
  if (!name || isShadowed(name, scopes)) {
    return undefined;
  }
  const failureAPIName = bindings.failureFunctions.get(name);
  if (failureAPIName) {
    return failureAPIName;
  }
  if (bindings.delayFunctions.has(name)) {
    return 'delay';
  }
  return undefined;
};

/**
 * Classify only Effect expressions whose construction-time state is provable.
 *
 * @internal
 */
export const effectResolutionOf = (
  value: ASTNode | undefined,
  bindings: EffectResolutionBindings,
  scopes: ScopeStack,
): EffectResolution => {
  const node = unwrappedExpression(value);
  if (node?.type !== 'CallExpression') {
    return 'unknown';
  }
  const APIName =
    effectCallAPIName(node, bindings.phase.effect, scopes) ||
    directCanonicalName(node, bindings, scopes);
  return resolutionForAPIName(APIName);
};

const resolutionForAPIName = (APIName: string | undefined): EffectResolution => {
  if (APIName === 'succeed') {
    return 'success';
  }
  if (APIName === 'fail' || APIName === 'failCause' || APIName === 'die') {
    return 'failure';
  }
  if (APIName === 'delay') {
    return 'pending';
  }
  return 'unknown';
};

/**
 * Check whether a resolved failure is guaranteed to contain a typed Fail reason.
 *
 * @internal
 */
export const isCatchableFailure = (
  value: ASTNode | undefined,
  bindings: EffectResolutionBindings,
  scopes: ScopeStack,
): boolean => {
  const node = unwrappedExpression(value);
  if (node?.type !== 'CallExpression') {
    return false;
  }
  const APIName =
    effectCallAPIName(node, bindings.phase.effect, scopes) ||
    directCanonicalName(node, bindings, scopes);
  return APIName === 'fail';
};

/**
 * Normalize an eager Effect call without guessing through dynamic values.
 *
 * @internal
 */
export const eagerEffectInvocation = (
  node: ASTNode,
  bindings: EffectResolutionBindings,
  scopes: ScopeStack,
): EagerEffectInvocation | undefined => {
  const APIName = eagerEffectAPIName(node, bindings.phase, scopes);
  if (APIName) {
    return directInvocation(node, APIName);
  }
  return curriedInvocation(node, bindings, scopes);
};

const matchPropertyName = (property: ASTNode): string | undefined => {
  const key = childNode(property, 'key');
  if (property.computed === true) {
    return Predicate.isString(key?.value) ? key.value : undefined;
  }
  return identifierName(key) ?? (Predicate.isString(key?.value) ? key.value : undefined);
};

interface MatchPropertySelection {
  isFinal: boolean;
  value?: ASTNode;
}

const matchPropertySelection = (
  property: ASTNode | undefined,
  selectedName: string,
): MatchPropertySelection => {
  if (!property || property.type !== 'Property') {
    return { isFinal: true };
  }
  const propertyName = matchPropertyName(property);
  if (!propertyName) {
    return { isFinal: true };
  }
  if (propertyName !== selectedName) {
    return { isFinal: false };
  }
  if (property.kind !== 'init') {
    return { isFinal: true };
  }
  return { isFinal: true, value: childNode(property, 'value') };
};

const matchCallbackName = (resolution: EffectResolution): string => {
  if (resolution === 'success') {
    return 'onSuccess';
  }
  return 'onFailure';
};

/**
 * Pick the only match callback selected by a statically resolved input.
 *
 * @internal
 */
export const selectedMatchCallback = (
  options: ASTNode | undefined,
  resolution: EffectResolution,
): ASTNode | undefined => {
  const object = unwrappedExpression(options);
  if (object?.type !== 'ObjectExpression') {
    return undefined;
  }
  const selectedName = matchCallbackName(resolution);
  const properties = childNodes(object, 'properties');
  for (let index = properties.length - 1; index >= 0; index -= 1) {
    const selection = matchPropertySelection(properties[index], selectedName);
    if (selection.isFinal) {
      return selection.value;
    }
  }
  return undefined;
};

const isSuccessCallback = (APIName: EagerEffectAPI, resolution: EffectResolution): boolean =>
  resolution === 'success' && (APIName === 'flatMapEager' || APIName === 'mapEager');

const isFailureCallback = (
  invocation: EagerEffectInvocation,
  resolution: EffectResolution,
  bindings: EffectResolutionBindings,
  scopes: ScopeStack,
): boolean =>
  resolution === 'failure' &&
  invocation.APIName === 'catchEager' &&
  isCatchableFailure(invocation.input, bindings, scopes);

const eagerMatchCallback = (
  invocation: EagerEffectInvocation,
  resolution: EffectResolution,
): ASTNode | undefined => {
  if (
    invocation.APIName === 'matchCauseEffectEager' &&
    (resolution === 'success' || resolution === 'failure')
  ) {
    return selectedMatchCallback(invocation.callback, resolution);
  }
  return undefined;
};

/**
 * Select the only eager callback proven to execute during construction.
 *
 * @internal
 */
export const selectedEagerCallback = (
  node: ASTNode,
  bindings: EffectResolutionBindings,
  scopes: ScopeStack,
): ASTNode | undefined => {
  const invocation = eagerEffectInvocation(node, bindings, scopes);
  if (!invocation?.input || !invocation.callback) {
    return undefined;
  }
  const resolution = effectResolutionOf(invocation.input, bindings, scopes);
  const matchCallback = eagerMatchCallback(invocation, resolution);
  if (matchCallback) {
    return matchCallback;
  }
  if (
    isSuccessCallback(invocation.APIName, resolution) ||
    isFailureCallback(invocation, resolution, bindings, scopes)
  ) {
    return invocation.callback;
  }
  return undefined;
};
