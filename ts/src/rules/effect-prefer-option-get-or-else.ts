/* -------------------------------------------------------------------------- */
/*      Prefer Option.getOrElse over Option.match with an identity arm.       */
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
  default as preferLayerSyncRule,
  preferAllDiscardRule,
  preferCollectionDiscardOverAsVoidRule,
  preferForEachDiscardRule,
  preferOptionNullishGettersRule,
} from './effect-prefer-layer-sync';

interface MatcherState {
  optionMatch: ImportedEffectCallMatcher;
  rootPackageNamespaces: ReadonlySet<string>;
}

interface HandlerProperty {
  name: string;
  value: ASTNode;
}

const MESSAGE = diagnosticMessage({
  example:
    'import { Option } from "effect"\n\n' +
    'const value = Option.getOrElse(decoded, () => fallback)',
  fix: 'Replace Option.match with Option.getOrElse and keep the onNone fallback.',
  summary:
    'Option.getOrElse expresses an Option.match whose onSome branch returns its argument more directly.',
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

const isRuntimeOptionImport = (statement: ASTNode): boolean => {
  if (
    statement.type !== 'ImportDeclaration' ||
    isTypeImport(statement) ||
    !['effect', 'effect/Option'].includes(literalString(childNode(statement, 'source')) ?? '')
  ) {
    return false;
  }
  const specifiers = childNodes(statement, 'specifiers');
  return (
    specifiers.length === 0 || specifiers.some((specifier): boolean => !isTypeImport(specifier))
  );
};

const hasRuntimeOptionImport = (program: ASTNode): boolean =>
  childNodes(program, 'body').some(isRuntimeOptionImport);

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

const hasUnsupportedMemberAccess = (node: ASTNode | undefined): boolean => {
  const seen = new WeakSet();
  let current = node;
  while (current?.type === 'MemberExpression') {
    if (Reflect.get(current, 'computed') === true || Reflect.get(current, 'optional') === true) {
      return true;
    }
    if (seen.has(current)) {
      return false;
    }
    seen.add(current);
    current = childNode(current, 'object');
  }
  return false;
};

const exactMatchArguments = (call: ASTNode): ASTNode[] | undefined => {
  if (
    Reflect.get(call, 'optional') === true ||
    hasTypeArguments(call) ||
    hasUnsupportedMemberAccess(childNode(call, 'callee'))
  ) {
    return undefined;
  }
  const callArguments = childNodes(call, 'arguments');
  if (
    callArguments.length !== 2 ||
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

const isConciseArrow = (node: ASTNode | undefined): node is ASTNode =>
  node?.type === 'ArrowFunctionExpression' &&
  Reflect.get(node, 'async') !== true &&
  Reflect.get(node, 'generator') !== true &&
  Reflect.get(node, 'expression') === true &&
  !childNode(node, 'returnType') &&
  !childNode(node, 'typeParameters');

const isOnNone = (node: ASTNode | undefined): boolean =>
  isConciseArrow(node) && childNodes(node, 'params').length === 0;

const isOnSomeIdentity = (node: ASTNode | undefined): boolean => {
  if (!isConciseArrow(node)) {
    return false;
  }
  const parameters = childNodes(node, 'params');
  const [parameter] = parameters;
  const parameterName = identifierName(parameter);
  return Boolean(
    parameters.length === 1 &&
    parameter &&
    parameterName &&
    Reflect.get(parameter, 'optional') !== true &&
    !childNode(parameter, 'typeAnnotation') &&
    identifierName(childNode(node, 'body')) === parameterName,
  );
};

const handlerProperty = (node: ASTNode | undefined): HandlerProperty | undefined => {
  if (
    node?.type !== 'Property' ||
    Reflect.get(node, 'kind') !== 'init' ||
    Reflect.get(node, 'computed') === true ||
    Reflect.get(node, 'method') === true ||
    Reflect.get(node, 'shorthand') === true
  ) {
    return undefined;
  }
  const name = identifierName(childNode(node, 'key'));
  const value = childNode(node, 'value');
  if (!name || !value) {
    return undefined;
  }
  return { name, value };
};

const isExactHandlerPair = (
  onNone: HandlerProperty | undefined,
  onSome: HandlerProperty | undefined,
): boolean =>
  onNone?.name === 'onNone' &&
  onSome?.name === 'onSome' &&
  isOnNone(onNone.value) &&
  isOnSomeIdentity(onSome.value);

const hasExactHandlers = (node: ASTNode | undefined): boolean => {
  if (node?.type !== 'ObjectExpression') {
    return false;
  }
  const properties = childNodes(node, 'properties');
  if (properties.length !== 2) {
    return false;
  }
  const first = handlerProperty(properties[0]);
  const second = handlerProperty(properties[1]);
  return isExactHandlerPair(first, second) || isExactHandlerPair(second, first);
};

const matchingCallee = (call: ASTNode, state: MatcherState): ASTNode | undefined => {
  const callArguments = exactMatchArguments(call);
  const callee = childNode(call, 'callee');
  if (
    callArguments &&
    !isDirectRootPackageCall(callee, state.rootPackageNamespaces) &&
    state.optionMatch.matches(callee) &&
    hasExactHandlers(callArguments[1])
  ) {
    return callee;
  }
  return undefined;
};

const hasCandidateTokens = (source: string): boolean =>
  source.includes('effect') &&
  source.includes('match') &&
  source.includes('onNone') &&
  source.includes('onSome');

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
        const callee = matchingCallee(call, state);
        if (callee) {
          context.report({ message: MESSAGE, node: callee });
        }
      },
      Program(value): void {
        const program = asNode(value);
        if (!program || !hasRuntimeOptionImport(program)) {
          return;
        }
        const optionMatch = importedEffectCallMatcher(context, 'Option', ['match']);
        optionMatch.initialize(program);
        state = {
          optionMatch,
          rootPackageNamespaces: rootPackageNamespaces(program),
        };
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
