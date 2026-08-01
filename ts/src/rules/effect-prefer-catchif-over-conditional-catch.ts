/* -------------------------------------------------------------------------- */
/*     Prefer Effect.catchIf for conditional recovery from typed errors.      */
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
    'program.pipe(\n  Effect.catchIf(isRecoverable, (error) => recover(error))\n)',
  fix:
    "Move the condition into Effect.catchIf's predicate and keep only the recovery callback; " +
    'negate the predicate when the fail branch comes first.',
  summary:
    'Use Effect.catchIf for predicate-based recovery instead of catching every typed error and re-failing the nonmatching branch.',
});

interface MatcherState {
  effectCatch: ImportedEffectCallMatcher;
  effectFail: ImportedEffectCallMatcher;
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
  const specifiers = childNodes(statement, 'specifiers');
  return (
    specifiers.length === 0 || specifiers.some((specifier): boolean => !isTypeImport(specifier))
  );
};

const hasRuntimeEffectImport = (program: ASTNode): boolean =>
  childNodes(program, 'body').some(isRuntimeEffectImport);

const isRootPackageNamespaceImport = (statement: ASTNode): boolean =>
  statement.type === 'ImportDeclaration' &&
  !isTypeImport(statement) &&
  literalString(childNode(statement, 'source')) === 'effect';

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
    if (isRootPackageNamespaceImport(statement)) {
      for (const specifier of childNodes(statement, 'specifiers')) {
        addRootPackageNamespace(namespaces, specifier);
      }
    }
  }
  return namespaces;
};

const hasTypeArguments = (node: ASTNode): boolean =>
  Boolean(childNode(node, 'typeArguments') || childNode(node, 'typeParameters'));

const hasOptionalMemberAccess = (node: ASTNode | undefined): boolean =>
  node?.type === 'MemberExpression' &&
  (Reflect.get(node, 'optional') === true || hasOptionalMemberAccess(childNode(node, 'object')));

const isPlainCall = (call: ASTNode): boolean =>
  Reflect.get(call, 'optional') !== true &&
  !hasTypeArguments(call) &&
  !hasOptionalMemberAccess(childNode(call, 'callee'));

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

const returnedConditional = (transform: ASTNode): ASTNode | undefined => {
  const body = childNode(transform, 'body');
  if (body?.type === 'ConditionalExpression') {
    return body;
  }
  return undefined;
};

const isUnsupportedCallback = (node: ASTNode): boolean =>
  Reflect.get(node, 'async') === true ||
  Reflect.get(node, 'generator') === true ||
  hasTypeArguments(node);

const callbackParameterName = (node: ASTNode | undefined): string | undefined => {
  if (node?.type !== 'ArrowFunctionExpression' || isUnsupportedCallback(node)) {
    return undefined;
  }
  const parameters = childNodes(node, 'params');
  if (parameters.length !== 1) {
    return undefined;
  }
  return identifierName(parameters[0]);
};

const isExactRefail = (
  branch: ASTNode | undefined,
  parameterName: string,
  state: MatcherState,
): boolean => {
  if (branch?.type !== 'CallExpression') {
    return false;
  }
  const callee = childNode(branch, 'callee');
  if (
    isDirectRootPackageCall(callee, state.rootPackageNamespaces) ||
    !state.effectFail.matches(callee)
  ) {
    return false;
  }
  const failArguments = exactArguments(branch, 1);
  return Boolean(failArguments && identifierName(failArguments[0]) === parameterName);
};

const catchCallback = (call: ASTNode): ASTNode | undefined => {
  const callArguments = childNodes(call, 'arguments');
  if (callArguments.length !== 1 && callArguments.length !== 2) {
    return undefined;
  }
  const exactCallArguments = exactArguments(call, callArguments.length);
  return exactCallArguments?.[exactCallArguments.length - 1];
};

const isConditionalCatch = (call: ASTNode, state: MatcherState): boolean => {
  const callback = catchCallback(call);
  const parameterName = callbackParameterName(callback);
  if (!callback || !parameterName) {
    return false;
  }
  const conditional = returnedConditional(callback);
  if (!conditional) {
    return false;
  }
  const consequentRefails = isExactRefail(
    childNode(conditional, 'consequent'),
    parameterName,
    state,
  );
  const alternateRefails = isExactRefail(childNode(conditional, 'alternate'), parameterName, state);
  return consequentRefails !== alternateRefails;
};

const hasCandidateTokens = (source: string): boolean =>
  source.includes('effect') &&
  source.includes('catch') &&
  source.includes('fail') &&
  source.includes('?') &&
  source.includes('=>');

const rule: SourceRule = {
  create(context: Context) {
    if (!hasCandidateTokens(readCachedSource(context))) {
      return { Program(): void {} };
    }

    const state: MatcherState = {
      effectCatch: importedEffectCallMatcher(context, 'Effect', ['catch', 'catchAll']),
      effectFail: importedEffectCallMatcher(context, 'Effect', ['fail']),
      rootPackageNamespaces: new Set(),
    };
    let isInitialized = false;

    return {
      CallExpression(value): void {
        if (!isInitialized) {
          return;
        }
        const call = asNode(value);
        if (
          call &&
          !isDirectRootPackageCall(childNode(call, 'callee'), state.rootPackageNamespaces) &&
          state.effectCatch.matches(childNode(call, 'callee')) &&
          isConditionalCatch(call, state)
        ) {
          context.report({ message: MESSAGE, node: childNode(call, 'callee') ?? call });
        }
      },
      Program(value): void {
        const program = asNode(value);
        if (!program || !hasRuntimeEffectImport(program)) {
          return;
        }
        state.effectCatch.initialize(program);
        state.effectFail.initialize(program);
        state.rootPackageNamespaces = rootPackageNamespaces(program);
        isInitialized = true;
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
