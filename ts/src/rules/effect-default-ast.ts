import { Array as EffectArray, Option, Predicate, pipe } from 'effect';
import { effectImportAliases } from './effect-rule-core';
import { isASTArray, isASTObject, isASTValue, type ASTNode, type ASTValue } from './effect-ast';

export type { ASTValue } from './effect-ast';

interface MemberParts {
  readonly objectName?: string;
  readonly propertyName?: string;
}

interface RuleContext {
  report: (descriptor: { message: string; node: ASTNode }) => void;
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

export const arrayValue = (node: ASTValue): ASTValue[] => (isASTArray(node) ? [...node] : []);

export const nodeType = (node: ASTValue): string | undefined =>
  pipe(
    Option.fromNullable(objectValue(node, 'type')),
    Option.filter(Predicate.isString),
    Option.getOrUndefined,
  );

export const identifierName = (node: ASTValue): string | undefined =>
  pipe(
    Option.some(node),
    Option.filter((value): boolean => nodeType(value) === 'Identifier'),
    Option.flatMap((value) => Option.fromNullable(objectValue(value, 'name'))),
    Option.filter(Predicate.isString),
    Option.getOrUndefined,
  );

export const memberParts = (node: ASTValue): MemberParts =>
  pipe(
    Option.some(node),
    Option.filter((value): boolean => nodeType(value) === 'MemberExpression'),
    Option.map((value) => ({
      objectName: identifierName(objectValue(value, 'object')),
      propertyName: identifierName(objectValue(value, 'property')),
    })),
    Option.getOrElse((): MemberParts => ({})),
  );

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
