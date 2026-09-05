/* -------------------------------------------------------------------------- */
/*          Allocation-conscious AST access for custom Effect rules.          */
/* -------------------------------------------------------------------------- */
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

/**
 * Narrow an unknown AST value to a node.
 *
 * @param value - A value read from an AST container.
 * @returns The value when it has a string node type; otherwise `undefined`.
 * @throws Does not throw.
 * @internal
 */
export const asNode = (value: ASTValue): ASTNode | undefined => {
  if (isASTNode(value)) {
    return value;
  }
  return undefined;
};

/**
 * Read one child node without exposing unchecked reflected values.
 *
 * @param node - The parent AST node.
 * @param key - The child property name.
 * @returns The child node, or `undefined` for a missing or invalid child.
 * @throws Does not throw.
 * @internal
 */
export const childNode = (node: ASTNode, key: string): ASTNode | undefined => {
  return asNode(node[key]);
};

/**
 * Read an AST child array while discarding sparse and non-node entries.
 *
 * @param node - The parent AST node.
 * @param key - The child-array property name.
 * @returns Valid child nodes in source order.
 * @throws Does not throw.
 * @internal
 */
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

/**
 * Read the name of an Identifier node.
 *
 * @param node - A possible Identifier node.
 * @returns The identifier name, or `undefined` for every other shape.
 * @throws Does not throw.
 * @internal
 */
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
