import { Predicate } from 'effect';
import type { Context, SourceRule } from './effect-rule-core';
import { asNode, childNode, childNodes } from './effect-ast';
import type { ASTNode, ASTValue } from './effect-ast';
import type { ImportedEffectCallMatcher } from './effect-imported-call-matcher';
import { diagnosticMessage } from './diagnostic-guidance';
import { importedEffectCallMatcher } from './effect-imported-call-matcher';
import { readCachedSource } from './source-cache';
import { strictPathOptionsSchema } from './effect-path-options';

const FACTORY_NAMES = ['TaggedClass', 'TaggedError', 'TaggedRequest', 'TaggedErrorClass'] as const;
const TOKENS = ['effect', 'Schema', 'Tagged', 'class'] as const;
const MAXIMUM_OUTER_ARGUMENTS = 3;

const MESSAGE = diagnosticMessage({
  example:
    'import { Schema } from "effect"\n\n' +
    'class NotFound extends Schema.TaggedErrorClass<NotFound>()("NotFound", { id: Schema.String }) {}',
  fix: 'Call the Schema tagged-class factory without the duplicate identifier.',
  summary: 'Remove the redundant Schema tag identifier when it equals the _tag value.',
});

const literalString = (node: ASTNode | undefined): string | undefined => {
  if (node?.type !== 'Literal') {
    return undefined;
  }
  const value = node.value;
  if (Predicate.isString(value)) {
    return value;
  }
  return undefined;
};

const hasTypeArguments = (node: ASTNode): boolean => Boolean(node.typeArguments);

const exactArguments = (
  call: ASTNode | undefined,
  minimum: number,
  maximum = minimum,
): ASTNode[] | undefined => {
  if (call?.type !== 'CallExpression') {
    return undefined;
  }
  const argumentsList = childNodes(call, 'arguments');
  if (
    argumentsList.length < minimum ||
    argumentsList.length > maximum ||
    argumentsList.some((argument): boolean => argument.type === 'SpreadElement')
  ) {
    return undefined;
  }
  return argumentsList;
};

const isSchemaImport = (statement: ASTNode): boolean => {
  const moduleName = literalString(childNode(statement, 'source'));
  return (
    statement.type === 'ImportDeclaration' &&
    (moduleName === 'effect' || moduleName === 'effect/Schema')
  );
};

const hasSchemaImport = (program: ASTNode): boolean =>
  childNodes(program, 'body').some(isSchemaImport);

const hasCandidateTokens = (source: string): boolean =>
  TOKENS.every((token): boolean => source.includes(token));

interface TaggedFactoryCandidate {
  factory: ASTNode | undefined;
  identifier: ASTNode;
  tag: ASTNode;
}

const taggedFactoryCandidate = (value: ASTValue): TaggedFactoryCandidate | undefined => {
  const declaration = asNode(value);
  const outerCall = declaration && childNode(declaration, 'superClass');
  if (!outerCall || hasTypeArguments(outerCall)) {
    return undefined;
  }
  const outerArguments = exactArguments(outerCall, 2, MAXIMUM_OUTER_ARGUMENTS);
  const innerCall = childNode(outerCall, 'callee');
  const innerArguments = exactArguments(innerCall, 1);
  if (!outerArguments || !innerCall || !innerArguments) {
    return undefined;
  }
  return {
    factory: childNode(innerCall, 'callee'),
    identifier: innerArguments[0],
    tag: outerArguments[0],
  };
};

const redundantIdentifier = (
  candidate: TaggedFactoryCandidate | undefined,
  schemaFactory: ImportedEffectCallMatcher,
  directRootFactory: ImportedEffectCallMatcher,
): ASTNode | undefined => {
  const identifierValue = literalString(candidate?.identifier);
  if (
    !candidate ||
    !schemaFactory.matches(candidate.factory) ||
    directRootFactory.matches(candidate.factory) ||
    identifierValue === undefined ||
    identifierValue !== literalString(candidate.tag)
  ) {
    return undefined;
  }
  return candidate.identifier;
};

const rule: SourceRule = {
  create(context: Context) {
    if (!hasCandidateTokens(readCachedSource(context))) {
      return { Program(): void {} };
    }

    const schemaFactory = importedEffectCallMatcher(context, 'Schema', FACTORY_NAMES);
    const directRootFactory = importedEffectCallMatcher(context, 'Effect', FACTORY_NAMES);

    return {
      ClassDeclaration(value): void {
        const identifier = redundantIdentifier(
          taggedFactoryCandidate(value),
          schemaFactory,
          directRootFactory,
        );
        if (!identifier) {
          return;
        }
        context.report({ message: MESSAGE, node: identifier });
      },
      Program(value): void {
        const program = asNode(value);
        if (!program || !hasSchemaImport(program)) {
          return;
        }
        schemaFactory.initialize(program);
        directRootFactory.initialize(program);
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
