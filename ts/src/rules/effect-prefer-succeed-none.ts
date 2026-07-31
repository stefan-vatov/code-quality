/* -------------------------------------------------------------------------- */
/*        Prefer Effect.succeedNone over succeeding with Option.none.         */
/* -------------------------------------------------------------------------- */

import type { Context, SourceRule } from './effect-rule-core';
import { asNode, childNode, childNodes } from './effect-ast';
import type { ASTNode } from './effect-ast';
import { diagnosticMessage } from './diagnostic-guidance';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';
import { readCachedSource } from './source-cache';
import { strictPathOptionsSchema } from './effect-path-options';

const MESSAGE = diagnosticMessage({
  example: 'import { Effect } from "effect"\n\nconst task = Effect.succeedNone',
  fix: 'Use the succeedNone export from the same Effect import style instead of nesting succeed around Option.none().',
  summary:
    'Effect.succeedNone expresses a successful None more directly than Effect.succeed(Option.none()).',
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

const directNoneCallFor = (succeedCall: ASTNode): ASTNode | undefined => {
  if (!isPlainCall(succeedCall)) {
    return undefined;
  }
  const succeedArguments = childNodes(succeedCall, 'arguments');
  if (succeedArguments.length !== 1) {
    return undefined;
  }
  const [noneCall] = succeedArguments;
  if (
    noneCall?.type !== 'CallExpression' ||
    !isPlainCall(noneCall) ||
    childNodes(noneCall, 'arguments').length !== 0
  ) {
    return undefined;
  }
  return noneCall;
};

const hasCandidateTokens = (source: string): boolean =>
  Math.min(source.indexOf('succeed'), source.indexOf('none')) >= 0;

const rule: SourceRule = {
  create(context: Context) {
    const source = readCachedSource(context);
    if (!hasCandidateTokens(source)) {
      return { Program(): void {} };
    }

    const effectSucceed = importedEffectCallMatcher(context, 'Effect', ['succeed']);
    const optionNone = importedEffectCallMatcher(context, 'Option', ['none']);
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
        const noneCall = directNoneCallFor(succeedCall);
        if (
          !noneCall ||
          !effectSucceed.matches(childNode(succeedCall, 'callee')) ||
          !optionNone.matches(childNode(noneCall, 'callee'))
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
        optionNone.initialize(program);
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
