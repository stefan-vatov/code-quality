import { Option, Predicate } from 'effect';

import type { ESTree, Scope, SourceCode, Variable } from '@oxlint/plugins';

type WrapperExpression =
  | ESTree.ChainExpression
  | ESTree.ParenthesizedExpression
  | ESTree.TSAsExpression
  | ESTree.TSNonNullExpression
  | ESTree.TSSatisfiesExpression
  | ESTree.TSTypeAssertion;

export interface ArrayMethodTarget {
  readonly name: string;
  readonly object: ESTree.Expression;
}

const wrapperTypes = new Set<string>([
  'ChainExpression',
  'ParenthesizedExpression',
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
]);

const arrayProducingMethods = new Set([
  'concat',
  'filter',
  'flatMap',
  'map',
  'slice',
  'toReversed',
  'toSorted',
  'toSpliced',
]);

const isWrapperExpression = (node: ESTree.Node): node is WrapperExpression =>
  wrapperTypes.has(node.type);

export function unwrapArrayExpression(node: ESTree.Node): ESTree.Node {
  let current = node;
  while (isWrapperExpression(current)) {
    current = current.expression;
  }
  return current;
}

function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.Node,
  name: string,
): Option.Option<Variable> {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(name);
    if (variable !== undefined) return Option.some(variable);
    scope = scope.upper;
  }
  return Option.none();
}

export function resolveArrayBinding(
  sourceCode: SourceCode,
  node: ESTree.Node,
): Option.Option<Variable> {
  const unwrapped = unwrapArrayExpression(node);
  return unwrapped.type === 'Identifier'
    ? resolveVariable(sourceCode, unwrapped, unwrapped.name)
    : Option.none<Variable>();
}

export function arrayMethodTarget(node: ESTree.Node): Option.Option<ArrayMethodTarget> {
  const target = unwrapArrayExpression(node);
  if (target.type !== 'MemberExpression') return Option.none();
  if (!target.computed && target.property.type === 'Identifier') {
    return Option.some({ name: target.property.name, object: target.object });
  }
  if (
    target.computed &&
    target.property.type === 'Literal' &&
    Predicate.isString(target.property.value)
  ) {
    return Option.some({ name: target.property.value, object: target.object });
  }
  return Option.none();
}

export const isReassigned = (variable: Variable): boolean =>
  variable.references.some((reference) => reference.isWrite() && !reference.init);

export function constInitializer(variable: Variable): Option.Option<ESTree.Expression> {
  for (const definition of variable.defs) {
    const declarator = definition.node;
    if (
      definition.type === 'Variable' &&
      declarator.type === 'VariableDeclarator' &&
      declarator.id.type === 'Identifier' &&
      declarator.init !== null &&
      declarator.parent.type === 'VariableDeclaration' &&
      declarator.parent.kind === 'const'
    ) {
      return Option.some(declarator.init);
    }
  }
  return Option.none();
}

function isArrayAnnotation(type: ESTree.TSType): boolean {
  if (type.type === 'TSArrayType' || type.type === 'TSTupleType') return true;
  if (type.type === 'TSParenthesizedType') return isArrayAnnotation(type.typeAnnotation);
  if (type.type === 'TSTypeOperator' && type.operator === 'readonly') {
    return isArrayAnnotation(type.typeAnnotation);
  }
  return (
    type.type === 'TSTypeReference' &&
    type.typeName.type === 'Identifier' &&
    (type.typeName.name === 'Array' || type.typeName.name === 'ReadonlyArray')
  );
}

function declaredAnnotation(variable: Variable): Option.Option<ESTree.TSType> {
  for (const identifier of variable.identifiers) {
    const annotation = 'typeAnnotation' in identifier ? identifier.typeAnnotation : undefined;
    if (annotation !== undefined && annotation !== null && annotation.type === 'TSTypeAnnotation') {
      return Option.some(annotation.typeAnnotation);
    }
  }
  return Option.none();
}

function isKnownArrayCall(
  sourceCode: SourceCode,
  call: ESTree.CallExpression,
  visited: Set<Variable>,
): boolean {
  return Option.match(arrayMethodTarget(call.callee), {
    onNone: () => false,
    onSome: (method) =>
      arrayProducingMethods.has(method.name) &&
      isKnownArrayExpression(sourceCode, method.object, visited),
  });
}

function isKnownArrayVariable(
  sourceCode: SourceCode,
  variable: Variable,
  visited: Set<Variable>,
): boolean {
  if (visited.has(variable) || isReassigned(variable)) return false;
  visited.add(variable);
  return Option.match(declaredAnnotation(variable), {
    onNone: () =>
      Option.match(constInitializer(variable), {
        onNone: () => false,
        onSome: (init) => isKnownArrayExpression(sourceCode, init, visited),
      }),
    onSome: isArrayAnnotation,
  });
}

export function isKnownArrayExpression(
  sourceCode: SourceCode,
  node: ESTree.Node,
  visited = new Set<Variable>(),
): boolean {
  const unwrapped = unwrapArrayExpression(node);
  if (unwrapped.type === 'ArrayExpression') return true;
  if (unwrapped.type === 'CallExpression') return isKnownArrayCall(sourceCode, unwrapped, visited);
  if (unwrapped.type !== 'Identifier') return false;
  return Option.match(resolveVariable(sourceCode, unwrapped, unwrapped.name), {
    onNone: () => false,
    onSome: (variable) => isKnownArrayVariable(sourceCode, variable, visited),
  });
}
