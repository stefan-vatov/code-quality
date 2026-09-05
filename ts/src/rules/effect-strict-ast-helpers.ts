import { Array, HashSet, Option, Predicate, pipe } from 'effect';
import { effectAPIAliases, effectFunctionAliases, effectImportAliases } from './effect-rule-core';
import { isASTArray, isASTObject, isASTValue, type ASTNode, type ASTValue } from './effect-ast';

interface RuleContext {
  report: (descriptor: {
    loc?: { column: number; line: number };
    message: string;
    node: ASTNode;
  }) => void;
}

interface MemberParts {
  readonly objectName?: string;
  readonly propertyName?: string;
}

interface ServiceKeyParts {
  readonly className?: string;
  readonly key?: string;
}

export const reportAST = (context: RuleContext, message: string, node: ASTNode): void => {
  context.report({ message, node });
};

export const objectValue = (node: ASTValue, key: string): ASTValue => {
  if (!isASTObject(node)) {
    return undefined;
  }
  const value = node[key];
  return isASTValue(value) ? value : undefined;
};

export const arrayValue = (node: ASTValue): ASTValue[] => {
  if (isASTArray(node)) {
    return [...node].filter(isASTValue);
  }
  return [];
};

export const nodeType = (node: ASTValue): string | undefined => {
  const type = objectValue(node, 'type');
  if (Predicate.isString(type)) {
    return type;
  }
  return undefined;
};

export const identifierName = (node: ASTValue): string | undefined => {
  if (nodeType(node) === 'Identifier') {
    const name = objectValue(node, 'name');
    if (Predicate.isString(name)) {
      return name;
    }
    return undefined;
  }
  return undefined;
};

export const literalValue = (node: ASTValue): ASTValue => {
  if (nodeType(node) === 'Literal') {
    return objectValue(node, 'value');
  }
  return undefined;
};

export const isVoidZero = (node: ASTValue): boolean => {
  if (nodeType(node) !== 'UnaryExpression') {
    return false;
  }
  return (
    objectValue(node, 'operator') === 'void' && literalValue(objectValue(node, 'argument')) === 0
  );
};

const memberParts = (node: ASTValue): MemberParts => {
  if (nodeType(node) !== 'MemberExpression') {
    return {};
  }
  return {
    objectName: identifierName(objectValue(node, 'object')),
    propertyName: identifierName(objectValue(node, 'property')),
  };
};

export const isMember = (node: ASTValue, objectName: string, propertyName: string): boolean => {
  const parts = memberParts(node);
  return parts.objectName === objectName && parts.propertyName === propertyName;
};

export const isSchemaMember = (node: ASTValue, source: string, propertyName: string): boolean => {
  const parts = memberParts(node);
  return Boolean(
    parts.objectName &&
    parts.propertyName === propertyName &&
    pipe(effectAPIAliases(source, 'Schema'), Array.contains(parts.objectName)),
  );
};

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
  if (Predicate.isString(value)) {
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

export const serviceKeyFromClass = (node: ASTValue, source: string): ServiceKeyParts => {
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
