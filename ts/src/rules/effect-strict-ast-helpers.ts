/* -------------------------------------------------------------------------- */
/*                AST helpers for opt-in strict Effect rules.                 */
/* -------------------------------------------------------------------------- */
import { Array, HashSet, Option, pipe } from 'effect';
import { effectAPIAliases, effectFunctionAliases, effectImportAliases } from './effect-rule-core';

interface RuleContext {
  report: (descriptor: {
    loc?: { column: number; line: number };
    message: string;
    node: object;
  }) => void;
}

type ASTValue = boolean | null | number | object | string | undefined;

const astValueTypes = HashSet.make('boolean', 'number', 'object', 'string');

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const reportAST = (context: RuleContext, message: string, node: object): void => {
  context.report({ message, node });
};

const isASTValue = (value: unknown): value is ASTValue =>
  value === undefined || value === null || HashSet.has(astValueTypes, typeof value);

/**
 * Internal helper exported for package-local composition.
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const arrayValue = (node: ASTValue): ASTValue[] => {
  if (globalThis.Array.isArray(node)) {
    return pipe(node, Array.filter(isASTValue));
  }
  return [];
};

/**
 * Internal helper exported for package-local composition.
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const identifierName = (node: ASTValue): string | undefined => {
  if (nodeType(node) === 'Identifier') {
    const name = objectValue(node, 'name');
    if (typeof name === 'string') {
      return name;
    }
    return undefined;
  }
  return undefined;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const literalValue = (node: ASTValue): ASTValue => {
  if (nodeType(node) === 'Literal') {
    return objectValue(node, 'value');
  }
  return undefined;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isVoidZero = (node: ASTValue): boolean => {
  if (nodeType(node) !== 'UnaryExpression') {
    return false;
  }
  return (
    objectValue(node, 'operator') === 'void' && literalValue(objectValue(node, 'argument')) === 0
  );
};

const memberParts = (node: ASTValue): { objectName?: string; propertyName?: string } => {
  if (nodeType(node) !== 'MemberExpression') {
    return {};
  }
  return {
    objectName: identifierName(objectValue(node, 'object')),
    propertyName: identifierName(objectValue(node, 'property')),
  };
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isMember = (node: ASTValue, objectName: string, propertyName: string): boolean => {
  const parts = memberParts(node);
  return parts.objectName === objectName && parts.propertyName === propertyName;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isSchemaMember = (node: ASTValue, source: string, propertyName: string): boolean => {
  const parts = memberParts(node);
  return Boolean(
    parts.objectName &&
    parts.propertyName === propertyName &&
    pipe(effectAPIAliases(source, 'Schema'), Array.contains(parts.objectName)),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectCallPredicate = (
  source: string,
  names: readonly string[],
): ((callee: ASTValue) => boolean) => {
  const memberNames = HashSet.fromIterable(names);
  const importAliases = pipe(effectImportAliases(source), HashSet.fromIterable);
  const functionAliases = pipe(
    names,
    Array.flatMap((name): readonly string[] => effectFunctionAliases(source, 'Effect', name)),
    HashSet.fromIterable,
  );

  return (callee: ASTValue): boolean => {
    const { objectName, propertyName } = memberParts(callee);
    if (objectName && propertyName) {
      return HashSet.has(importAliases, objectName) && HashSet.has(memberNames, propertyName);
    }

    const calleeName = identifierName(callee);
    return Boolean(calleeName && HashSet.has(functionAliases, calleeName));
  };
};

const literalStringValue = (node: ASTValue): string | undefined => {
  const value = literalValue(node);
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
};

const contextTagServiceKey = (innerArguments: ASTValue): string | undefined =>
  pipe(
    arrayValue(innerArguments),
    Array.head,
    Option.flatMapNullable(literalStringValue),
    Option.getOrUndefined,
  );

const effectServiceKey = (outerArguments: ASTValue): string | undefined =>
  pipe(
    arrayValue(outerArguments),
    Array.head,
    Option.flatMapNullable(literalStringValue),
    Option.getOrUndefined,
  );

const contextTagKeyFromMember = (
  member: { objectName?: string; propertyName?: string },
  innerArguments: ASTValue,
): string | undefined => {
  if (
    member.objectName === 'Context' &&
    (member.propertyName === 'Tag' || member.propertyName === 'GenericTag')
  ) {
    return contextTagServiceKey(innerArguments);
  }
  return undefined;
};

const effectServiceKeyFromMember = (
  source: string,
  member: { objectName?: string; propertyName?: string },
  outerArguments: ASTValue,
): string | undefined => {
  if (
    member.objectName &&
    pipe(effectImportAliases(source), Array.contains(member.objectName)) &&
    member.propertyName === 'Service'
  ) {
    return effectServiceKey(outerArguments);
  }
  return undefined;
};

const serviceClassSuperCallParts = (
  node: ASTValue,
): { className?: string; inner: ASTValue; outerArguments: ASTValue } | undefined => {
  const superClass = objectValue(node, 'superClass');
  const className = identifierName(objectValue(node, 'id'));
  if (nodeType(superClass) !== 'CallExpression') {
    return undefined;
  }
  const inner = objectValue(superClass, 'callee');
  if (!inner || nodeType(inner) !== 'CallExpression') {
    return undefined;
  }
  return { className, inner, outerArguments: objectValue(superClass, 'arguments') };
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const serviceKeyFromClass = (
  node: ASTValue,
  source: string,
): { className?: string; key?: string } => {
  const className = identifierName(objectValue(node, 'id'));
  const parts = serviceClassSuperCallParts(node);
  if (!parts) {
    return { className };
  }
  const innerArguments = objectValue(parts.inner, 'arguments');
  const member = memberParts(objectValue(parts.inner, 'callee'));
  const key =
    contextTagKeyFromMember(member, innerArguments) ??
    effectServiceKeyFromMember(source, member, parts.outerArguments);
  if (key) {
    return { className, key };
  }
  return { className };
};
