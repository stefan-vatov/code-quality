/* -------------------------------------------------------------------------- */
/*        Prefer Effect.succeedSome over succeeding with Option.some.         */
/* -------------------------------------------------------------------------- */

import type { Context, SourceRule } from './effect-rule-core';
import { asNode, childNode, childNodes } from './effect-ast';
import type { ASTNode } from './effect-ast';
import { diagnosticMessage } from './diagnostic-guidance';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';
import { readCachedSource } from './source-cache';
import { strictPathOptionsSchema } from './effect-path-options';

const MESSAGE = diagnosticMessage({
  example: 'import { Effect } from "effect"\n\nconst task = Effect.succeedSome(value)',
  fix: 'Use the succeedSome export from the same Effect import style and pass the value directly.',
  summary:
    'Effect.succeedSome expresses a successful Some more directly than Effect.succeed(Option.some(value)).',
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

const isEffectImport = (statement: ASTNode): boolean => {
  if (statement.type !== 'ImportDeclaration') {
    return false;
  }
  const source = literalString(childNode(statement, 'source'));
  return source === 'effect' || source === 'effect/Effect' || source === 'effect/Option';
};

const hasEffectImport = (program: ASTNode): boolean =>
  childNodes(program, 'body').some(isEffectImport);

const hasTypeArguments = (call: ASTNode): boolean =>
  Boolean(childNode(call, 'typeArguments') || childNode(call, 'typeParameters'));

const hasOptionalMemberAccess = (callee: ASTNode | undefined): boolean => {
  if (callee?.type !== 'MemberExpression') {
    return false;
  }
  if (Reflect.get(callee, 'optional') === true) {
    return true;
  }
  return hasOptionalMemberAccess(childNode(callee, 'object'));
};

const isOptionalCall = (call: ASTNode): boolean =>
  Reflect.get(call, 'optional') === true || hasOptionalMemberAccess(childNode(call, 'callee'));

const isPlainCall = (call: ASTNode): boolean => !isOptionalCall(call) && !hasTypeArguments(call);

const parenthesizedExpression = (node: ASTNode | undefined): ASTNode | undefined => {
  if (node?.type === 'ParenthesizedExpression') {
    return parenthesizedExpression(childNode(node, 'expression'));
  }
  return node;
};

const singleNonSpreadArgument = (call: ASTNode): ASTNode | undefined => {
  const callArguments = childNodes(call, 'arguments');
  if (callArguments.length !== 1 || callArguments[0]?.type === 'SpreadElement') {
    return undefined;
  }
  return callArguments[0];
};

const directSomeCallFor = (succeedCall: ASTNode): ASTNode | undefined => {
  if (!isPlainCall(succeedCall)) {
    return undefined;
  }
  const someCall = parenthesizedExpression(singleNonSpreadArgument(succeedCall));
  if (someCall?.type !== 'CallExpression' || !isPlainCall(someCall)) {
    return undefined;
  }
  if (!singleNonSpreadArgument(someCall)) {
    return undefined;
  }
  return someCall;
};

const hasCandidateTokens = (source: string): boolean =>
  Math.min(source.indexOf('succeed'), source.indexOf('some')) >= 0;

const rule: SourceRule = {
  create(context: Context) {
    const source = readCachedSource(context);
    if (!hasCandidateTokens(source)) {
      return { Program(): void {} };
    }

    const effectSucceed = importedEffectCallMatcher(context, 'Effect', ['succeed']);
    const optionSome = importedEffectCallMatcher(context, 'Option', ['some']);
    let hasImportedEffectAPI = false;

    return {
      CallExpression(value): void {
        if (!hasImportedEffectAPI) {
          return;
        }
        const succeedCall = asNode(value);
        if (!succeedCall) {
          return;
        }
        const someCall = directSomeCallFor(succeedCall);
        if (
          !someCall ||
          !effectSucceed.matches(childNode(succeedCall, 'callee')) ||
          !optionSome.matches(childNode(someCall, 'callee'))
        ) {
          return;
        }
        context.report({ message: MESSAGE, node: childNode(succeedCall, 'callee') ?? succeedCall });
      },
      Program(value): void {
        const program = asNode(value);
        if (!program || !hasEffectImport(program)) {
          return;
        }
        hasImportedEffectAPI = true;
        effectSucceed.initialize(program);
        optionSome.initialize(program);
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
