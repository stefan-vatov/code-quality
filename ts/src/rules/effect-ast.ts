/* -------------------------------------------------------------------------- */
/*          Allocation-conscious AST access for custom Effect rules.          */
/* -------------------------------------------------------------------------- */

export type ASTNode = object & { type: string };

const hasNodeType = (value: object): value is ASTNode =>
  'type' in value && typeof value.type === 'string';

const isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/**
 * Narrow an unknown AST value to a node.
 *
 * @param value - A value read from an AST container.
 * @returns The value when it has a string node type; otherwise `undefined`.
 * @throws Does not throw.
 * @internal
 */
export const asNode = <Value>(value: Value): (Value & ASTNode) | undefined => {
  if (value !== null && typeof value === 'object' && hasNodeType(value)) {
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
  const value: unknown = Reflect.get(node, key);
  return asNode(value);
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
  const value: unknown = Reflect.get(node, key);
  if (!isUnknownArray(value)) {
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
  const name: unknown = Reflect.get(node, 'name');
  if (typeof name === 'string') {
    return name;
  }
  return undefined;
};
