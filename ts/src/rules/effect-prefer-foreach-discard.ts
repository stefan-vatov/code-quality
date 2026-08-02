/* -------------------------------------------------------------------------- */
/*        Prefer discard mode when Effect.gen ignores forEach results.        */
/* -------------------------------------------------------------------------- */

import type { Context, SourceRule } from './effect-rule-core';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';
import type { ImportedEffectCallMatcher } from './effect-imported-call-matcher';
import { diagnosticMessage } from './diagnostic-guidance';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';
import { readCachedSource } from './source-cache';
import { strictPathOptionsSchema } from './effect-path-options';
import { visitASTWithStack } from './effect-ast-stack-safe-walker';

const MESSAGE = diagnosticMessage({
  example:
    'import { Effect } from "effect"\n\n' +
    'Effect.gen(function* () {\n' +
    '  yield* Effect.forEach(items, work, { concurrency: 4, discard: true })\n' +
    '})',
  fix: 'Add discard: true to the existing options object, or add an options object when none exists.',
  summary:
    'Effect.forEach with { discard: true } avoids collecting a result array when a delegated yield ignores the result.',
});

interface MatcherState {
  effectForEach: ImportedEffectCallMatcher;
  effectGen: ImportedEffectCallMatcher;
  rootPackageNamespaces: ReadonlySet<string>;
}

const SAFE_OPTION_KEYS = new Set(['batching', 'concurrency', 'concurrentFinalizers']);
const FOREACH_ARGUMENT_COUNT = 2;
const FOREACH_WITH_OPTIONS_ARGUMENT_COUNT = 3;

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
  const specifiers = childNodes(statement, 'specifiers');
  return specifiers.some((specifier): boolean => !isTypeImport(specifier));
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
      childNodes(statement, 'specifiers').forEach((specifier): void => {
        addRootPackageNamespace(namespaces, specifier);
      });
    }
  }
  return namespaces;
};

const hasTypeArguments = (node: ASTNode): boolean =>
  Boolean(childNode(node, 'typeArguments') || childNode(node, 'typeParameters'));

const hasUnsupportedMemberAccess = (node: ASTNode | undefined): boolean => {
  const seen = new WeakSet();
  let current = node;
  while (current?.type === 'MemberExpression' && !seen.has(current)) {
    seen.add(current);
    if (Reflect.get(current, 'computed') === true || Reflect.get(current, 'optional') === true) {
      return true;
    }
    current = childNode(current, 'object');
  }
  return false;
};

const isPlainCall = (call: ASTNode): boolean =>
  Reflect.get(call, 'optional') !== true &&
  !hasTypeArguments(call) &&
  !hasUnsupportedMemberAccess(childNode(call, 'callee'));

const boundedArguments = (
  call: ASTNode,
  minimumCount: number,
  maximumCount: number,
): ASTNode[] | undefined => {
  if (!isPlainCall(call)) {
    return undefined;
  }
  const callArguments = childNodes(call, 'arguments');
  if (callArguments.length < minimumCount || callArguments.length > maximumCount) {
    return undefined;
  }
  for (const argument of callArguments) {
    if (argument.type === 'SpreadElement') {
      return undefined;
    }
  }
  return callArguments;
};

const staticPropertyName = (property: ASTNode): string | undefined => {
  const key = childNode(property, 'key');
  return identifierName(key) ?? literalString(key);
};

const isSafeOptionsProperty = (property: ASTNode): boolean => {
  if (
    property.type !== 'Property' ||
    Reflect.get(property, 'kind') !== 'init' ||
    Reflect.get(property, 'computed') === true ||
    Reflect.get(property, 'method') === true ||
    Reflect.get(property, 'optional') === true
  ) {
    return false;
  }
  const name = staticPropertyName(property);
  return Boolean(name && SAFE_OPTION_KEYS.has(name));
};

const isSafeOptions = (node: ASTNode): boolean =>
  node.type === 'ObjectExpression' && childNodes(node, 'properties').every(isSafeOptionsProperty);

const isDirectRootPackageAPI = (
  callee: ASTNode | undefined,
  namespaces: ReadonlySet<string>,
): boolean =>
  callee?.type === 'MemberExpression' &&
  namespaces.has(identifierName(childNode(callee, 'object')) ?? '');

const isDataFirstForEach = (call: ASTNode, state: MatcherState): boolean => {
  const callee = childNode(call, 'callee');
  if (
    !state.effectForEach.matches(callee) ||
    isDirectRootPackageAPI(callee, state.rootPackageNamespaces)
  ) {
    return false;
  }
  const callArguments = boundedArguments(
    call,
    FOREACH_ARGUMENT_COUNT,
    FOREACH_WITH_OPTIONS_ARGUMENT_COUNT,
  );
  if (!callArguments) {
    return false;
  }
  const [, callback, options] = callArguments;
  if (callArguments.length === FOREACH_ARGUMENT_COUNT) {
    return callback?.type !== 'ObjectExpression';
  }
  return options !== undefined && isSafeOptions(options);
};

const reportIgnoredForEach = (
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
  if (call?.type === 'CallExpression' && isDataFirstForEach(call, state)) {
    context.report({ message: MESSAGE, node: childNode(call, 'callee') ?? call });
  }
};

const isFunction = (node: ASTNode): boolean =>
  node.type === 'ArrowFunctionExpression' ||
  node.type === 'FunctionDeclaration' ||
  node.type === 'FunctionExpression';

interface DiscardTraversalContext {
  parent: ASTNode | undefined;
}

const scanGeneratorBody = (context: Context, body: ASTNode, state: MatcherState): void => {
  const initialTraversalContext: DiscardTraversalContext = { parent: undefined };
  visitASTWithStack({
    context: initialTraversalContext,
    onNode(node, _nodeScopes, _inheritedScopes, traversalContext) {
      reportIgnoredForEach(context, node, traversalContext.parent, state);
      return {
        context: { parent: node },
        visitChildren: !isFunction(node),
      };
    },
    root: body,
    scopes: [],
  });
};

const supportedGenerator = (call: ASTNode): ASTNode | undefined => {
  const callArguments = boundedArguments(call, 1, 2);
  const generator = callArguments?.[callArguments.length - 1];
  if (
    generator?.type !== 'FunctionExpression' ||
    Reflect.get(generator, 'generator') !== true ||
    Reflect.get(generator, 'async') === true ||
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
    scanGeneratorBody(context, body, state);
  }
};

const hasCandidateTokens = (source: string): boolean =>
  source.includes('forEach') && source.includes('gen') && source.includes('yield');

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
          effectForEach: importedEffectCallMatcher(context, 'Effect', ['forEach']),
          effectGen: importedEffectCallMatcher(context, 'Effect', ['gen']),
          rootPackageNamespaces: rootPackageNamespaces(program),
        };
        matcherState.effectForEach.initialize(program);
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
