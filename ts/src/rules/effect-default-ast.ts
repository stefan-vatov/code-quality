/** @internal Shared AST helpers for custom Effect rule modules. */
import { effectFunctionAliases, effectImportAliases } from './effect-rule-core';

interface RuleContext {
  report: (descriptor: { message: string; node: object }) => void;
}

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export type ASTValue = boolean | null | number | object | string | undefined;

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const reportAST = (context: RuleContext, message: string, node: object): void => {
  context.report({ message, node });
};

const isASTValue = (value: unknown): value is ASTValue =>
  value === undefined ||
  value === null ||
  ['boolean', 'number', 'object', 'string'].includes(typeof value);

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const objectValue = (node: ASTValue, key: string): ASTValue => {
  if (typeof node !== 'object' || node === null) {
    return undefined;
  }
  const value: unknown = Reflect.get(node, key);
  if (isASTValue(value)) {
    return value;
  }
  return undefined;
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const arrayValue = (node: ASTValue): ASTValue[] => {
  if (Array.isArray(node)) {
    return node.filter(isASTValue);
  }
  return [];
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const nodeType = (node: ASTValue): string | undefined => {
  const type = objectValue(node, 'type');
  if (typeof type === 'string') {
    return type;
  }
  return undefined;
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const identifierName = (node: ASTValue): string | undefined => {
  if (nodeType(node) === 'Identifier') {
    const name = objectValue(node, 'name');
    if (typeof name === 'string') {
      return name;
    }
  }
  return undefined;
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const literalValue = (node: ASTValue): ASTValue => {
  if (nodeType(node) === 'Literal') {
    return objectValue(node, 'value');
  }
  return undefined;
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isStringLikeLiteral = (node: ASTValue): boolean => {
  if (typeof literalValue(node) === 'string') {
    return true;
  }
  if (nodeType(node) !== 'TemplateLiteral') {
    return false;
  }
  const expressions = objectValue(node, 'expressions');
  if (!Array.isArray(expressions)) {
    return false;
  }
  return expressions.length === 0;
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const memberParts = (node: ASTValue): { objectName?: string; propertyName?: string } => {
  if (nodeType(node) !== 'MemberExpression') {
    return {};
  }
  return {
    objectName: identifierName(objectValue(node, 'object')),
    propertyName: identifierName(objectValue(node, 'property')),
  };
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectCallPredicate = (
  source: string,
  names: readonly string[],
): ((callee: ASTValue) => boolean) => {
  const memberNames = new Set(names);
  const importAliases = new Set(effectImportAliases(source));
  const functionAliases = new Set(
    names.flatMap((name) => effectFunctionAliases(source, 'Effect', name)),
  );

  return (callee: ASTValue): boolean => {
    const { objectName, propertyName } = memberParts(callee);
    if (objectName && propertyName) {
      return importAliases.has(objectName) && memberNames.has(propertyName);
    }

    const calleeName = identifierName(callee);
    return Boolean(calleeName && functionAliases.has(calleeName));
  };
};

const typeReferenceQualifiedName = (typeName: ASTValue): string | undefined => {
  if (nodeType(typeName) !== 'TSQualifiedName') {
    return undefined;
  }
  const leftName = identifierName(objectValue(typeName, 'left'));
  const rightName = identifierName(objectValue(typeName, 'right'));
  if (leftName && rightName) {
    return `${leftName}.${rightName}`;
  }
  return undefined;
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const propertyKeyName = (node: ASTValue): string | undefined => {
  const name = identifierName(node);
  if (name) {
    return name;
  }
  const value = literalValue(node);
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const typeReferenceName = (node: ASTValue): string | undefined => {
  if (nodeType(node) !== 'TSTypeReference') {
    return undefined;
  }
  const typeName = objectValue(node, 'typeName');
  if (nodeType(typeName) === 'Identifier') {
    return identifierName(typeName);
  }
  return typeReferenceQualifiedName(typeName);
};

const firstTypeArgumentName = (node: ASTValue): string | undefined => {
  const typeArguments = objectValue(node, 'typeArguments');
  const params = objectValue(typeArguments, 'params');
  const [firstParam] = arrayValue(params);
  return typeReferenceName(firstParam);
};

const effectServiceSelfFromInnerCall = (
  inner: ASTValue,
  outerSelf: string | undefined,
  source: string,
): string | undefined => {
  const { objectName, propertyName } = memberParts(objectValue(inner, 'callee'));
  if (objectName === 'Context' && propertyName === 'Tag') {
    return outerSelf;
  }
  if (
    objectName &&
    propertyName === 'Service' &&
    effectImportAliases(source).includes(objectName)
  ) {
    return firstTypeArgumentName(inner);
  }
  return undefined;
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectServiceSelfName = (superClass: ASTValue, source: string): string | undefined => {
  if (nodeType(superClass) !== 'CallExpression') {
    return undefined;
  }
  const typeArguments = objectValue(superClass, 'typeArguments');
  const params = objectValue(typeArguments, 'params');
  const [firstParam] = arrayValue(params);
  const outerSelf = typeReferenceName(firstParam);
  const inner = objectValue(superClass, 'callee');
  if (nodeType(inner) !== 'CallExpression') {
    return undefined;
  }
  return effectServiceSelfFromInnerCall(inner, outerSelf, source);
};
