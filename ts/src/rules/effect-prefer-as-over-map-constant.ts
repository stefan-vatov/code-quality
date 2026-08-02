/* -------------------------------------------------------------------------- */
/*       Prefer Effect.as over mapping to a stable primitive constant.        */
/* -------------------------------------------------------------------------- */

import type { Context, SourceRule } from './effect-rule-core';
import { asNode, childNode, childNodes, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';
import { diagnosticMessage } from './diagnostic-guidance';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';
import { readCachedSource } from './source-cache';
import { strictPathOptionsSchema } from './effect-path-options';

const MESSAGE = diagnosticMessage({
  example: 'import { Effect } from "effect"\n\nconst completed = program.pipe(Effect.as("done"))',
  fix: 'Use the as export from the same Effect import style and pass the constant directly.',
  summary:
    'Effect.as expresses replacing an Effect success value with a stable constant more directly than Effect.map with a constant callback.',
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
  const seen = new WeakSet();
  let current = node;
  while (current?.type === 'MemberExpression') {
    if (Reflect.get(current, 'optional') === true) {
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
  !hasOptionalMemberAccess(childNode(call, 'callee'));

const parenthesizedExpression = (node: ASTNode | undefined): ASTNode | undefined => {
  const seen = new WeakSet();
  let expression = node;
  while (expression?.type === 'ParenthesizedExpression') {
    if (seen.has(expression)) {
      return undefined;
    }
    seen.add(expression);
    expression = childNode(expression, 'expression');
  }
  return expression;
};

const isStableLiteral = (node: ASTNode): boolean => {
  if (node.type !== 'Literal') {
    return false;
  }
  const value: unknown = Reflect.get(node, 'value');
  return (
    value === null ||
    typeof value === 'bigint' ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  );
};

const isStaticTemplate = (node: ASTNode): boolean =>
  node.type === 'TemplateLiteral' && childNodes(node, 'expressions').length === 0;

const isNumericUnary = (node: ASTNode): boolean => {
  if (node.type !== 'UnaryExpression') {
    return false;
  }
  const operator: unknown = Reflect.get(node, 'operator');
  const argument = childNode(node, 'argument');
  return (
    (operator === '+' || operator === '-') &&
    argument?.type === 'Literal' &&
    typeof Reflect.get(argument, 'value') === 'number'
  );
};

const isDirectStableConstant = (value: ASTNode | undefined): boolean => {
  const expression = parenthesizedExpression(value);
  return Boolean(
    expression &&
    (isStableLiteral(expression) || isStaticTemplate(expression) || isNumericUnary(expression)),
  );
};

const isConstAssertion = (node: ASTNode): boolean => {
  if (node.type !== 'TSAsExpression') {
    return false;
  }
  const annotation = childNode(node, 'typeAnnotation');
  return (
    annotation?.type === 'TSTypeReference' &&
    identifierName(childNode(annotation, 'typeName')) === 'const' &&
    !hasTypeArguments(annotation)
  );
};

const isStableConstant = (value: ASTNode | undefined): boolean => {
  const expression = parenthesizedExpression(value);
  if (!expression) {
    return false;
  }
  if (isDirectStableConstant(expression)) {
    return true;
  }
  return (
    isConstAssertion(expression) && isDirectStableConstant(childNode(expression, 'expression'))
  );
};

const isConstantCallback = (node: ASTNode | undefined): boolean =>
  node?.type === 'ArrowFunctionExpression' &&
  Reflect.get(node, 'async') === false &&
  Reflect.get(node, 'generator') === false &&
  Reflect.get(node, 'expression') === true &&
  childNodes(node, 'params').length === 0 &&
  !childNode(node, 'returnType') &&
  !childNode(node, 'typeParameters') &&
  isStableConstant(childNode(node, 'body'));

const exactMapArguments = (call: ASTNode): ASTNode[] | undefined => {
  const callArguments = childNodes(call, 'arguments');
  if (callArguments.length !== 1 && callArguments.length !== 2) {
    return undefined;
  }
  for (const callArgument of callArguments) {
    if (callArgument.type === 'SpreadElement') {
      return undefined;
    }
  }
  return callArguments;
};

const constantCallbackFor = (call: ASTNode): ASTNode | undefined => {
  if (!isPlainCall(call)) {
    return undefined;
  }
  const callArguments = exactMapArguments(call);
  if (!callArguments) {
    return undefined;
  }
  const callback = callArguments[callArguments.length - 1];
  if (isConstantCallback(callback)) {
    return callback;
  }
  return undefined;
};

const hasCandidateTokens = (source: string): boolean =>
  source.includes('map') && source.includes('=>');

const rule: SourceRule = {
  create(context: Context) {
    if (!hasCandidateTokens(readCachedSource(context))) {
      return { Program(): void {} };
    }

    const effectMap = importedEffectCallMatcher(context, 'Effect', ['map']);
    let isInitialized = false;

    return {
      CallExpression(value): void {
        if (!isInitialized) {
          return;
        }
        const call = asNode(value);
        if (call && constantCallbackFor(call) && effectMap.matches(childNode(call, 'callee'))) {
          context.report({ message: MESSAGE, node: childNode(call, 'callee') ?? call });
        }
      },
      Program(value): void {
        const program = asNode(value);
        if (!program || !hasEffectImport(program)) {
          return;
        }
        isInitialized = true;
        effectMap.initialize(program);
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
