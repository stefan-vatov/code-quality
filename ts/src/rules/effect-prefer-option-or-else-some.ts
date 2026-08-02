/* -------------------------------------------------------------------------- */
/*       Prefer Option.orElseSome when a fallback always returns Some.        */
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
  default as preferOptionGetOrElseRule,
  preferAllDiscardRule,
  preferCollectionDiscardOverAsVoidRule,
  preferForEachDiscardRule,
  preferLayerSyncRule,
  preferOptionNullishGettersRule,
} from './effect-prefer-option-get-or-else';

interface MatcherState {
  optionOrElse: ImportedEffectCallMatcher;
  optionSome: ImportedEffectCallMatcher;
  rootPackageNamespaces: ReadonlySet<string>;
}

const MESSAGE = diagnosticMessage({
  example:
    'import { Option } from "effect"\n\n' +
    'const value = Option.orElseSome(decoded, () => fallback)',
  fix: 'Replace Option.orElse with Option.orElseSome and return the fallback value directly.',
  summary:
    'Option.orElseSome expresses an Option.orElse fallback that always wraps a value in Option.some more directly.',
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

const isPlainCall = (call: ASTNode): boolean =>
  Reflect.get(call, 'optional') !== true &&
  !hasTypeArguments(call) &&
  !hasUnsupportedMemberAccess(childNode(call, 'callee'));

const exactArguments = (call: ASTNode): ASTNode[] | undefined => {
  if (!isPlainCall(call)) {
    return undefined;
  }
  const callArguments = childNodes(call, 'arguments');
  if (callArguments.some((argument): boolean => argument.type === 'SpreadElement')) {
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

const isConciseFallback = (node: ASTNode | undefined): node is ASTNode =>
  node?.type === 'ArrowFunctionExpression' &&
  Reflect.get(node, 'async') !== true &&
  Reflect.get(node, 'generator') !== true &&
  Reflect.get(node, 'expression') === true &&
  childNodes(node, 'params').length === 0 &&
  !childNode(node, 'returnType') &&
  !childNode(node, 'typeParameters');

const isExactSomeFallback = (callback: ASTNode | undefined, state: MatcherState): boolean => {
  if (!isConciseFallback(callback)) {
    return false;
  }
  const someCall = childNode(callback, 'body');
  if (someCall?.type !== 'CallExpression') {
    return false;
  }
  const someArguments = exactArguments(someCall);
  const someCallee = childNode(someCall, 'callee');
  return (
    someArguments?.length === 1 &&
    !isDirectRootPackageCall(someCallee, state.rootPackageNamespaces) &&
    state.optionSome.matches(someCallee)
  );
};

const matchingCallee = (call: ASTNode, state: MatcherState): ASTNode | undefined => {
  const callArguments = exactArguments(call);
  if (!callArguments || (callArguments.length !== 1 && callArguments.length !== 2)) {
    return undefined;
  }
  const callee = childNode(call, 'callee');
  const callback = callArguments.at(-1);
  if (
    !isDirectRootPackageCall(callee, state.rootPackageNamespaces) &&
    state.optionOrElse.matches(callee) &&
    isExactSomeFallback(callback, state)
  ) {
    return callee;
  }
  return undefined;
};

const hasCandidateTokens = (source: string): boolean =>
  source.includes('effect') && source.includes('orElse') && source.includes('some');

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
        const optionOrElse = importedEffectCallMatcher(context, 'Option', ['orElse']);
        const optionSome = importedEffectCallMatcher(context, 'Option', ['some']);
        optionOrElse.initialize(program);
        optionSome.initialize(program);
        state = {
          optionOrElse,
          optionSome,
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
