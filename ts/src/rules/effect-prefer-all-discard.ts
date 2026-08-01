/* -------------------------------------------------------------------------- */
/*          Prefer discard mode when Effect.gen ignores all results.          */
/* -------------------------------------------------------------------------- */

import type { Context, SourceRule } from './effect-rule-core';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';
import type { ImportedEffectCallMatcher } from './effect-imported-call-matcher';
import { diagnosticMessage } from './diagnostic-guidance';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';
import { readCachedSource } from './source-cache';
import { strictPathOptionsSchema } from './effect-path-options';

const MESSAGE = diagnosticMessage({
  example:
    'import { Effect } from "effect"\n\n' +
    'Effect.gen(function* () {\n' +
    '  yield* Effect.all([first, second], { discard: true })\n' +
    '})',
  fix: 'Pass { discard: true } as the second argument.',
  summary:
    "Effect.all with { discard: true } avoids collecting successful values when a delegated yield ignores an array literal's result.",
});

interface MatcherState {
  effectAll: ImportedEffectCallMatcher;
  effectGen: ImportedEffectCallMatcher;
  rootPackageNamespaces: ReadonlySet<string>;
}

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

const isRuntimeEffectImport = (statement: ASTNode): boolean => {
  if (statement.type !== 'ImportDeclaration' || isTypeImport(statement)) {
    return false;
  }
  const source = literalString(childNode(statement, 'source'));
  if (source !== 'effect' && source !== 'effect/Effect') {
    return false;
  }
  return childNodes(statement, 'specifiers').some((specifier): boolean => !isTypeImport(specifier));
};

const hasRuntimeEffectImport = (program: ASTNode): boolean =>
  childNodes(program, 'body').some(isRuntimeEffectImport);

const addRootPackageNamespace = (namespaces: Set<string>, specifier: ASTNode): void => {
  if (specifier.type !== 'ImportNamespaceSpecifier' || isTypeImport(specifier)) {
    return;
  }
  const name = identifierName(childNode(specifier, 'local'));
  if (name) {
    namespaces.add(name);
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
  if (node?.type !== 'MemberExpression') {
    return false;
  }
  return (
    Reflect.get(node, 'computed') === true ||
    Reflect.get(node, 'optional') === true ||
    hasUnsupportedMemberAccess(childNode(node, 'object'))
  );
};

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

const isDirectRootPackageAPI = (
  callee: ASTNode | undefined,
  namespaces: ReadonlySet<string>,
): boolean =>
  callee?.type === 'MemberExpression' &&
  namespaces.has(identifierName(childNode(callee, 'object')) ?? '');

const isArrayAllCall = (call: ASTNode, state: MatcherState): boolean => {
  const callee = childNode(call, 'callee');
  if (
    !state.effectAll.matches(callee) ||
    isDirectRootPackageAPI(callee, state.rootPackageNamespaces)
  ) {
    return false;
  }
  const callArguments = exactArguments(call, 1);
  const input = callArguments?.[0];
  return (
    input?.type === 'ArrayExpression' &&
    !childNodes(input, 'elements').some((element): boolean => element.type === 'SpreadElement')
  );
};

const reportIgnoredAll = (
  context: Context,
  node: ASTNode,
  parent: ASTNode | undefined,
  state: MatcherState,
): void => {
  if (
    node.type !== 'YieldExpression' ||
    Reflect.get(node, 'delegate') !== true ||
    parent?.type !== 'ExpressionStatement' ||
    childNode(parent, 'expression') !== node
  ) {
    return;
  }
  const call = childNode(node, 'argument');
  if (call?.type === 'CallExpression' && isArrayAllCall(call, state)) {
    context.report({ message: MESSAGE, node: childNode(call, 'callee') ?? call });
  }
};

const isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);

const scanValue = (
  context: Context,
  value: unknown,
  parent: ASTNode,
  state: MatcherState,
): void => {
  if (isUnknownArray(value)) {
    for (const item of value) {
      const child = asNode(item);
      if (child) {
        scanNode(context, child, parent, state);
      }
    }
    return;
  }
  const child = asNode(value);
  if (child) {
    scanNode(context, child, parent, state);
  }
};

const isFunction = (node: ASTNode): boolean =>
  node.type === 'ArrowFunctionExpression' ||
  node.type === 'FunctionDeclaration' ||
  node.type === 'FunctionExpression';

const scanNode = (
  context: Context,
  node: ASTNode,
  parent: ASTNode | undefined,
  state: MatcherState,
): void => {
  if (isFunction(node)) {
    return;
  }
  reportIgnoredAll(context, node, parent, state);
  for (const key of Object.keys(node)) {
    if (
      key !== 'parent' &&
      key !== 'type' &&
      key !== 'start' &&
      key !== 'end' &&
      key !== 'loc' &&
      key !== 'range'
    ) {
      scanValue(context, Reflect.get(node, key), node, state);
    }
  }
};

const supportedGenerator = (call: ASTNode): ASTNode | undefined => {
  const generator = exactArguments(call, 1)?.[0];
  if (
    generator?.type !== 'FunctionExpression' ||
    Reflect.get(generator, 'generator') !== true ||
    Reflect.get(generator, 'async') === true ||
    childNodes(generator, 'params').length !== 0 ||
    hasTypeArguments(generator) ||
    childNode(generator, 'id') ||
    childNode(generator, 'returnType')
  ) {
    return undefined;
  }
  return generator;
};

const scanGenCall = (context: Context, call: ASTNode, state: MatcherState): void => {
  const callee = childNode(call, 'callee');
  if (
    !state.effectGen.matches(callee) ||
    isDirectRootPackageAPI(callee, state.rootPackageNamespaces)
  ) {
    return;
  }
  const generator = supportedGenerator(call);
  const body = generator && childNode(generator, 'body');
  if (body) {
    scanNode(context, body, undefined, state);
  }
};

const hasCandidateTokens = (source: string): boolean =>
  source.includes('effect') &&
  source.includes('gen') &&
  source.includes('all') &&
  source.includes('yield');

const rule: SourceRule = {
  create(context: Context) {
    if (!hasCandidateTokens(readCachedSource(context))) {
      return { Program(): void {} };
    }

    let state: MatcherState | undefined = undefined;

    return {
      CallExpression(value): void {
        const call = asNode(value);
        if (call && state) {
          scanGenCall(context, call, state);
        }
      },
      Program(value): void {
        const program = asNode(value);
        if (!program || !hasRuntimeEffectImport(program)) {
          return;
        }
        const matcherState: MatcherState = {
          effectAll: importedEffectCallMatcher(context, 'Effect', ['all']),
          effectGen: importedEffectCallMatcher(context, 'Effect', ['gen']),
          rootPackageNamespaces: rootPackageNamespaces(program),
        };
        matcherState.effectAll.initialize(program);
        matcherState.effectGen.initialize(program);
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
export { default as preferForEachDiscardRule } from './effect-prefer-foreach-discard';
