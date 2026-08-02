/* -------------------------------------------------------------------------- */
/*       Exact Schema.TaggedError superclass matching for yield rules.        */
/* -------------------------------------------------------------------------- */

import { childNode, childNodes } from './effect-ast';
import type { ASTNode } from './effect-ast';
import type { ImportedEffectCallMatcher } from './effect-imported-call-matcher';

const MAXIMUM_FACTORY_ARGUMENTS = 1;
const MINIMUM_TAGGED_ERROR_ARGUMENTS = 2;
const MAXIMUM_TAGGED_ERROR_ARGUMENTS = MINIMUM_TAGGED_ERROR_ARGUMENTS + MAXIMUM_FACTORY_ARGUMENTS;

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

const hasTypeArguments = (node: ASTNode): boolean =>
  Boolean(childNode(node, 'typeArguments') || childNode(node, 'typeParameters'));

const hasUnsupportedMemberAccess = (node: ASTNode | undefined): boolean => {
  const seen = new WeakSet();
  let current = node;
  while (current?.type === 'MemberExpression') {
    if (seen.has(current)) {
      return true;
    }
    seen.add(current);
    if (Reflect.get(current, 'computed') === true || Reflect.get(current, 'optional') === true) {
      return true;
    }
    current = childNode(current, 'object');
  }
  return false;
};

const isPlainCall = (node: ASTNode): boolean =>
  Reflect.get(node, 'optional') !== true &&
  !hasTypeArguments(node) &&
  !hasUnsupportedMemberAccess(childNode(node, 'callee'));

const schemaFactoryArguments = (node: ASTNode): ASTNode[] | undefined => {
  if (
    node.type !== 'CallExpression' ||
    Reflect.get(node, 'optional') === true ||
    hasUnsupportedMemberAccess(childNode(node, 'callee'))
  ) {
    return undefined;
  }
  const argumentsList = childNodes(node, 'arguments');
  if (
    argumentsList.length > MAXIMUM_FACTORY_ARGUMENTS ||
    argumentsList.some((argument): boolean => argument.type === 'SpreadElement')
  ) {
    return undefined;
  }
  return argumentsList;
};

const schemaTaggedErrorArguments = (node: ASTNode | undefined): ASTNode[] | undefined => {
  if (node?.type !== 'CallExpression' || !isPlainCall(node)) {
    return undefined;
  }
  const argumentsList = childNodes(node, 'arguments');
  if (
    argumentsList.length < MINIMUM_TAGGED_ERROR_ARGUMENTS ||
    argumentsList.length > MAXIMUM_TAGGED_ERROR_ARGUMENTS ||
    argumentsList.some((argument): boolean => argument.type === 'SpreadElement') ||
    literalString(argumentsList[0]) === undefined
  ) {
    return undefined;
  }
  return argumentsList;
};

const hasSchemaIdentifier = (argumentsList: readonly ASTNode[]): boolean =>
  argumentsList.length === 0 || literalString(argumentsList[0]) !== undefined;

/**
 * Recognize an official Schema.TaggedError class superclass that yields a Cause.YieldableError.
 *
 * @param node - The class superclass expression to inspect.
 * @param schemaTaggedError - Provenance-aware matcher for the Schema.TaggedError factory.
 * @returns Whether the expression is an exact supported Schema.TaggedError construction.
 * @throws Does not throw.
 */
export const isSchemaTaggedErrorSuperclass = (
  node: ASTNode | undefined,
  schemaTaggedError: ImportedEffectCallMatcher,
): boolean => {
  const outerArguments = schemaTaggedErrorArguments(node);
  if (!node || !outerArguments) {
    return false;
  }
  const factoryCall = childNode(node, 'callee');
  const factoryArguments = factoryCall && schemaFactoryArguments(factoryCall);
  return Boolean(
    factoryCall &&
    factoryArguments &&
    hasSchemaIdentifier(factoryArguments) &&
    schemaTaggedError.matches(childNode(factoryCall, 'callee')),
  );
};
