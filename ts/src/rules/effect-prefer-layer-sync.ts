/* -------------------------------------------------------------------------- */
/*        Prefer Layer.sync over Layer.effect wrapping an Effect.sync.        */
/* -------------------------------------------------------------------------- */

import type { Context, SourceRule } from './effect-rule-core';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';
import type { ImportedEffectCallMatcher } from './effect-imported-call-matcher';
import { diagnosticMessage } from './diagnostic-guidance';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';
import { readCachedSource } from './source-cache';
import { strictPathOptionsSchema } from './effect-path-options';

export {
  default as preferOptionNullishGettersRule,
  preferAllDiscardRule,
  preferCollectionDiscardOverAsVoidRule,
  preferForEachDiscardRule,
} from './effect-prefer-option-nullish-getters';

interface MatcherState {
  effectSync: ImportedEffectCallMatcher;
  layerEffect: ImportedEffectCallMatcher;
  rootPackageNamespaces: ReadonlySet<string>;
}

const MESSAGE = diagnosticMessage({
  example:
    'import { Layer } from "effect"\n\nconst live = Layer.sync(Service, () => makeService())',
  fix: 'Pass the Effect.sync thunk directly to Layer.sync.',
  summary:
    'Layer.sync expresses synchronous service construction more directly than Layer.effect with Effect.sync.',
});

const literalString = (node: ASTNode | undefined): string | undefined => {
  if (node?.type !== 'Literal') {
    return undefined;
  }
  const value: unknown = Reflect.get(node, 'value');
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
};

const isTypeImport = (node: ASTNode): boolean => Reflect.get(node, 'importKind') === 'type';

const isEffectModule = (source: string | undefined): boolean =>
  source === 'effect' || source === 'effect/Effect' || source === 'effect/Layer';

const isRuntimeEffectImport = (statement: ASTNode): boolean => {
  if (
    statement.type !== 'ImportDeclaration' ||
    isTypeImport(statement) ||
    !isEffectModule(literalString(childNode(statement, 'source')))
  ) {
    return false;
  }
  const specifiers = childNodes(statement, 'specifiers');
  return (
    specifiers.length === 0 || specifiers.some((specifier): boolean => !isTypeImport(specifier))
  );
};

const hasRuntimeEffectImport = (program: ASTNode): boolean =>
  childNodes(program, 'body').some(isRuntimeEffectImport);

const addRootPackageNamespace = (namespaces: Set<string>, specifier: ASTNode): void => {
  if (specifier.type !== 'ImportNamespaceSpecifier' || isTypeImport(specifier)) {
    return;
  }
  const localName = identifierName(childNode(specifier, 'local'));
  if (localName) {
    namespaces.add(localName);
  }
};

const rootPackageNamespaces = (program: ASTNode): ReadonlySet<string> => {
  const namespaces = new Set<string>();
  for (const statement of childNodes(program, 'body')) {
    if (
      statement.type === 'ImportDeclaration' &&
      !isTypeImport(statement) &&
      literalString(childNode(statement, 'source')) === 'effect'
    ) {
      for (const specifier of childNodes(statement, 'specifiers')) {
        addRootPackageNamespace(namespaces, specifier);
      }
    }
  }
  return namespaces;
};

const hasTypeArguments = (node: ASTNode): boolean =>
  Boolean(childNode(node, 'typeArguments') || childNode(node, 'typeParameters'));

const hasUnsupportedMemberAccess = (node: ASTNode | undefined): boolean =>
  node?.type === 'MemberExpression' &&
  (Reflect.get(node, 'computed') === true ||
    Reflect.get(node, 'optional') === true ||
    hasUnsupportedMemberAccess(childNode(node, 'object')));

const isPlainCall = (call: ASTNode): boolean =>
  Reflect.get(call, 'optional') !== true &&
  !hasTypeArguments(call) &&
  !hasUnsupportedMemberAccess(childNode(call, 'callee'));

const exactArguments = (call: ASTNode, expectedCount: number): ASTNode[] | undefined => {
  if (!isPlainCall(call)) {
    return undefined;
  }
  const callArguments = childNodes(call, 'arguments');
  if (
    callArguments.length !== expectedCount ||
    callArguments.some((argument): boolean => argument.type === 'SpreadElement')
  ) {
    return undefined;
  }
  return callArguments;
};

const isDirectRootPackageCall = (
  callee: ASTNode | undefined,
  namespaces: ReadonlySet<string>,
): boolean =>
  callee?.type === 'MemberExpression' &&
  namespaces.has(identifierName(childNode(callee, 'object')) ?? '');

const isImportedCall = (
  callee: ASTNode | undefined,
  matcher: ImportedEffectCallMatcher,
  namespaces: ReadonlySet<string>,
): boolean => !isDirectRootPackageCall(callee, namespaces) && matcher.matches(callee);

const isSupportedInlineThunk = (node: ASTNode | undefined): node is ASTNode =>
  (node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression') &&
  childNodes(node, 'params').length === 0 &&
  Reflect.get(node, 'async') !== true &&
  Reflect.get(node, 'generator') !== true;

const singleReturnExpression = (body: ASTNode): ASTNode | undefined => {
  const statements = childNodes(body, 'body');
  const [statement] = statements;
  if (statements.length === 1 && statement?.type === 'ReturnStatement') {
    return childNode(statement, 'argument');
  }
  return undefined;
};

const returnedExpression = (thunk: ASTNode | undefined): ASTNode | undefined => {
  if (!isSupportedInlineThunk(thunk)) {
    return undefined;
  }
  const body = childNode(thunk, 'body');
  if (body?.type === 'BlockStatement') {
    return singleReturnExpression(body);
  }
  return body;
};

const hasStableThunkResult = (thunk: ASTNode | undefined): boolean => {
  const expression = returnedExpression(thunk);
  return expression?.type === 'Literal' || identifierName(expression) !== undefined;
};

const isEffectSyncCall = (node: ASTNode | undefined, state: MatcherState): boolean => {
  if (node?.type !== 'CallExpression') {
    return false;
  }
  const callArguments = exactArguments(node, 1);
  return Boolean(
    callArguments &&
    isImportedCall(childNode(node, 'callee'), state.effectSync, state.rootPackageNamespaces) &&
    !hasStableThunkResult(callArguments[0]),
  );
};

const dataFirstLayerCallee = (call: ASTNode, state: MatcherState): ASTNode | undefined => {
  const callArguments = exactArguments(call, 2);
  const callee = childNode(call, 'callee');
  if (
    callArguments &&
    isImportedCall(callee, state.layerEffect, state.rootPackageNamespaces) &&
    isEffectSyncCall(callArguments[1], state)
  ) {
    return callee;
  }
  return undefined;
};

const curriedLayerCallee = (call: ASTNode, state: MatcherState): ASTNode | undefined => {
  const callArguments = exactArguments(call, 1);
  const layerHead = childNode(call, 'callee');
  if (!callArguments || layerHead?.type !== 'CallExpression' || !exactArguments(layerHead, 1)) {
    return undefined;
  }
  const callee = childNode(layerHead, 'callee');
  if (
    isImportedCall(callee, state.layerEffect, state.rootPackageNamespaces) &&
    isEffectSyncCall(callArguments[0], state)
  ) {
    return callee;
  }
  return undefined;
};

const matchingLayerCallee = (call: ASTNode, state: MatcherState): ASTNode | undefined =>
  dataFirstLayerCallee(call, state) ?? curriedLayerCallee(call, state);

const hasCandidateTokens = (source: string): boolean =>
  source.includes('effect') && source.includes('Layer') && source.includes('sync');

const rule: SourceRule = {
  create(context: Context) {
    if (!hasCandidateTokens(readCachedSource(context))) {
      return { Program(): void {} };
    }

    let state: MatcherState | undefined = undefined;

    return {
      CallExpression(value): void {
        const call = asNode(value);
        if (!call || !state) {
          return;
        }
        const callee = matchingLayerCallee(call, state);
        if (callee) {
          context.report({ message: MESSAGE, node: callee });
        }
      },
      Program(value): void {
        const program = asNode(value);
        if (!program || !hasRuntimeEffectImport(program)) {
          return;
        }
        const matcherState: MatcherState = {
          effectSync: importedEffectCallMatcher(context, 'Effect', ['sync']),
          layerEffect: importedEffectCallMatcher(context, 'Layer', ['effect']),
          rootPackageNamespaces: rootPackageNamespaces(program),
        };
        matcherState.effectSync.initialize(program);
        matcherState.layerEffect.initialize(program);
        state = matcherState;
      },
    };
  },
  meta: {
    docs: {
      description: MESSAGE,
    },
    schema: strictPathOptionsSchema,
    type: 'problem',
  },
};

export default rule;
