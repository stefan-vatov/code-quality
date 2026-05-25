/* -------------------------------------------------------------------------- */
/*             Shared AST helpers for custom Effect rule modules.             */
/* -------------------------------------------------------------------------- */
import { Array as EffectArray, HashSet, Option, Predicate, pipe } from 'effect';
import { effectFunctionAliases, effectImportAliases } from './effect-rule-core';

interface RuleContext {
  report: (descriptor: { message: string; node: object }) => void;
}

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export type ASTValue = boolean | null | number | object | string | undefined;
type ReflectedASTValue = ASTValue | bigint | symbol | ((...args: readonly never[]) => ASTValue);

const astValueTypeNames: HashSet.HashSet<string> = HashSet.make(
  'boolean',
  'number',
  'object',
  'string',
);

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const reportAST = (context: RuleContext, message: string, node: object): void => {
  context.report({ message, node });
};

const isASTValue = (value: ReflectedASTValue): value is ASTValue =>
  value === undefined || value === null || HashSet.has(astValueTypeNames, typeof value);

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const objectValue = (node: ASTValue, key: string): ASTValue =>
  pipe(
    Option.fromNullable(node),
    Option.filter(Predicate.isObject),
    Option.flatMap((objectNode) => {
      // oxlint-disable-next-line typescript/no-unsafe-assignment -- AST-REFLECT-001 validated below.
      const value: ReflectedASTValue = Reflect.get(objectNode, key);
      if (isASTValue(value)) {
        return Option.some(value);
      }
      return Option.none<ASTValue>();
    }),
    Option.getOrUndefined,
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const arrayValue = (node: ASTValue): ASTValue[] =>
  pipe(
    Option.some(node),
    Option.filter(Array.isArray),
    Option.map(EffectArray.filter(isASTValue)),
    Option.getOrElse((): ASTValue[] => []),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const nodeType = (node: ASTValue): string | undefined =>
  pipe(
    Option.fromNullable(objectValue(node, 'type')),
    Option.filter(Predicate.isString),
    Option.getOrUndefined,
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const identifierName = (node: ASTValue): string | undefined =>
  pipe(
    Option.some(node),
    Option.filter((value): boolean => nodeType(value) === 'Identifier'),
    Option.flatMap((value) => Option.fromNullable(objectValue(value, 'name'))),
    Option.filter(Predicate.isString),
    Option.getOrUndefined,
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const literalValue = (node: ASTValue): ASTValue =>
  pipe(
    Option.some(node),
    Option.filter((value): boolean => nodeType(value) === 'Literal'),
    Option.map((value): ASTValue => objectValue(value, 'value')),
    Option.getOrUndefined,
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isStringLikeLiteral = (node: ASTValue): boolean =>
  pipe(Option.fromNullable(literalValue(node)), Option.exists(Predicate.isString)) ||
  pipe(
    Option.some(node),
    Option.filter((value): boolean => nodeType(value) === 'TemplateLiteral'),
    Option.map((value): ASTValue => objectValue(value, 'expressions')),
    Option.filter(Array.isArray),
    Option.exists((expressions): boolean => expressions.length === 0),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const memberParts = (node: ASTValue): { objectName?: string; propertyName?: string } =>
  pipe(
    Option.some(node),
    Option.filter((value): boolean => nodeType(value) === 'MemberExpression'),
    Option.map((value) => ({
      objectName: identifierName(objectValue(value, 'object')),
      propertyName: identifierName(objectValue(value, 'property')),
    })),
    Option.getOrElse((): { objectName?: string; propertyName?: string } => ({})),
  );

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
  const importAliases = HashSet.fromIterable(effectImportAliases(source));
  const functionAliases = HashSet.fromIterable(
    pipe(
      names,
      EffectArray.flatMap((name) => effectFunctionAliases(source, 'Effect', name)),
    ),
  );

  return (callee: ASTValue): boolean => {
    const { objectName, propertyName } = memberParts(callee);
    if (objectName && propertyName) {
      return HashSet.has(importAliases, objectName) && HashSet.has(memberNames, propertyName);
    }

    const calleeName = identifierName(callee);
    return pipe(
      Option.fromNullable(calleeName),
      Option.exists((value): boolean => HashSet.has(functionAliases, value)),
    );
  };
};

const typeReferenceQualifiedName = (typeName: ASTValue): string | undefined =>
  pipe(
    Option.some(typeName),
    Option.filter((value): boolean => nodeType(value) === 'TSQualifiedName'),
    Option.flatMap((value) =>
      pipe(
        Option.fromNullable(identifierName(objectValue(value, 'left'))),
        Option.flatMap((leftName) =>
          pipe(
            Option.fromNullable(identifierName(objectValue(value, 'right'))),
            Option.map((rightName): string => `${leftName}.${rightName}`),
          ),
        ),
      ),
    ),
    Option.getOrUndefined,
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const propertyKeyName = (node: ASTValue): string | undefined =>
  pipe(
    Option.fromNullable(identifierName(node)),
    Option.orElse(() =>
      pipe(Option.fromNullable(literalValue(node)), Option.filter(Predicate.isString)),
    ),
    Option.getOrUndefined,
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const typeReferenceName = (node: ASTValue): string | undefined =>
  pipe(
    Option.some(node),
    Option.filter((value): boolean => nodeType(value) === 'TSTypeReference'),
    Option.map((value): ASTValue => objectValue(value, 'typeName')),
    Option.flatMap((typeName) =>
      pipe(
        Option.some(typeName),
        Option.filter((value): boolean => nodeType(value) === 'Identifier'),
        Option.flatMap((value) => Option.fromNullable(identifierName(value))),
        Option.orElse(() => Option.fromNullable(typeReferenceQualifiedName(typeName))),
      ),
    ),
    Option.getOrUndefined,
  );

const firstTypeArgumentName = (node: ASTValue): string | undefined => {
  const typeArguments = objectValue(node, 'typeArguments');
  const params = objectValue(typeArguments, 'params');
  return pipe(
    arrayValue(params),
    EffectArray.head,
    Option.flatMap((firstParam) => Option.fromNullable(typeReferenceName(firstParam))),
    Option.getOrUndefined,
  );
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
    propertyName === 'Service' &&
    pipe(effectImportAliases(source), EffectArray.contains(objectName))
  ) {
    return firstTypeArgumentName(inner);
  }
  return undefined;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const effectServiceSelfName = (superClass: ASTValue, source: string): string | undefined =>
  pipe(
    Option.some(superClass),
    Option.filter((value): boolean => nodeType(value) === 'CallExpression'),
    Option.flatMap((value) => {
      const typeArguments = objectValue(value, 'typeArguments');
      const params = objectValue(typeArguments, 'params');
      const outerSelf = pipe(
        arrayValue(params),
        EffectArray.head,
        Option.flatMap((firstParam) => Option.fromNullable(typeReferenceName(firstParam))),
        Option.getOrUndefined,
      );
      return pipe(
        Option.some(objectValue(value, 'callee')),
        Option.filter((inner): boolean => nodeType(inner) === 'CallExpression'),
        Option.flatMap((inner) =>
          Option.fromNullable(effectServiceSelfFromInnerCall(inner, outerSelf, source)),
        ),
      );
    }),
    Option.getOrUndefined,
  );
