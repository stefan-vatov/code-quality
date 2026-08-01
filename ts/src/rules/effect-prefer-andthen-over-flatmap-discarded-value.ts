/* -------------------------------------------------------------------------- */
/*    Prefer Effect.andThen when flatMap discards the prior success value.    */
/* -------------------------------------------------------------------------- */

import type { Context, SourceRule } from './effect-rule-core';
import { asNode, childNode, childNodes } from './effect-ast';
import type { ASTNode } from './effect-ast';
import { diagnosticMessage } from './diagnostic-guidance';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';
import { readCachedSource } from './source-cache';
import { strictPathOptionsSchema } from './effect-path-options';

const MESSAGE = diagnosticMessage({
  example:
    'import { Effect } from "effect"\n\n' +
    'const result = first.pipe(Effect.andThen(() => second))',
  fix: 'Replace Effect.flatMap with Effect.andThen and keep the zero-parameter callback unchanged.',
  summary:
    'Effect.andThen expresses sequencing an Effect when the previous success value is unused ' +
    'more directly than Effect.flatMap with a zero-parameter callback.',
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

const hasEffectImport = (program: ASTNode): boolean => {
  for (const statement of childNodes(program, 'body')) {
    if (statement.type === 'ImportDeclaration') {
      const source = literalString(childNode(statement, 'source'));
      if (source === 'effect' || source === 'effect/Effect') {
        return true;
      }
    }
  }
  return false;
};

const hasTypeArguments = (node: ASTNode): boolean =>
  Boolean(childNode(node, 'typeArguments') || childNode(node, 'typeParameters'));

const hasOptionalMemberAccess = (node: ASTNode | undefined): boolean => {
  if (node?.type !== 'MemberExpression') {
    return false;
  }
  return (
    Reflect.get(node, 'optional') === true || hasOptionalMemberAccess(childNode(node, 'object'))
  );
};

const isPlainCall = (call: ASTNode): boolean =>
  Reflect.get(call, 'optional') !== true &&
  !hasTypeArguments(call) &&
  !hasOptionalMemberAccess(childNode(call, 'callee'));

const isSupportedCallback = (node: ASTNode | undefined): boolean =>
  node?.type === 'ArrowFunctionExpression' &&
  Reflect.get(node, 'async') !== true &&
  Reflect.get(node, 'generator') !== true &&
  !hasTypeArguments(node) &&
  childNodes(node, 'params').length === 0;

const discardedValueCallback = (call: ASTNode): ASTNode | undefined => {
  const callArguments = childNodes(call, 'arguments');
  if (
    (callArguments.length !== 1 && callArguments.length !== 2) ||
    callArguments.some((argument): boolean => argument.type === 'SpreadElement')
  ) {
    return undefined;
  }
  const callback = callArguments[callArguments.length - 1];
  if (isSupportedCallback(callback)) {
    return callback;
  }
  return undefined;
};

const hasCandidateTokens = (source: string): boolean =>
  source.includes('flatMap') && source.includes('=>');

const rule: SourceRule = {
  create(context: Context) {
    if (!hasCandidateTokens(readCachedSource(context))) {
      return { Program(): void {} };
    }

    const effectFlatMap = importedEffectCallMatcher(context, 'Effect', ['flatMap']);
    let isInitialized = false;

    return {
      CallExpression(value): void {
        if (!isInitialized) {
          return;
        }
        const call = asNode(value);
        if (
          call &&
          effectFlatMap.matches(childNode(call, 'callee')) &&
          isPlainCall(call) &&
          discardedValueCallback(call)
        ) {
          context.report({ message: MESSAGE, node: childNode(call, 'callee') ?? call });
        }
      },
      Program(value): void {
        const program = asNode(value);
        if (!program || !hasEffectImport(program)) {
          return;
        }
        isInitialized = true;
        effectFlatMap.initialize(program);
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
