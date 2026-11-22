import { Predicate } from 'effect';

export type ASTValue =
  | boolean
  | null
  | number
  | string
  | undefined
  | readonly ASTValue[]
  | { readonly [key: string]: ASTValue };

export type ASTObject = Extract<ASTValue, { readonly [key: string]: ASTValue }>;

export type ASTNode = ASTObject & { readonly type: string };

export const isASTObject = (value: ASTValue): value is ASTObject => Predicate.isRecord(value);

export const isASTArray = (value: ASTValue): value is readonly ASTValue[] => Array.isArray(value);

export const isASTValue = (value: ASTValue): value is ASTValue => !Predicate.isFunction(value);

export const isASTNode = (value: ASTValue): value is ASTNode =>
  isASTObject(value) && Predicate.isString(value.type);

export const asNode = (value: ASTValue): ASTNode | undefined => {
  if (isASTNode(value)) {
    return value;
  }
  return undefined;
};

export const childNode = (node: ASTNode, key: string): ASTNode | undefined => {
  return asNode(node[key]);
};

export const childNodes = (node: ASTNode, key: string): ASTNode[] => {
  const value = node[key];
  if (!isASTArray(value)) {
    return [];
  }
  const nodes: ASTNode[] = [];
  for (const item of value) {
    const child = asNode(item);
    if (child) {
      nodes.push(child);
    }
  }
  return nodes;
};

export const identifierName = (node: ASTNode | undefined): string | undefined => {
  if (node?.type !== 'Identifier') {
    return undefined;
  }
  const name = node.name;
  if (Predicate.isString(name)) {
    return name;
  }
  return undefined;
};
