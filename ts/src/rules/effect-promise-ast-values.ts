/* -------------------------------------------------------------------------- */
/*          Static AST values shared by Promise execution analysis.           */
/* -------------------------------------------------------------------------- */

import { asNode, childNode, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';

/**
 * Native Promise static methods that synchronously construct a Promise value.
 *
 * @internal
 */
export const PROMISE_STATIC_METHODS: ReadonlySet<string> = new Set([
  'all',
  'allSettled',
  'any',
  'race',
  'reject',
  'resolve',
]);

/**
 * Read an AST array while preserving sparse entries.
 *
 * @internal
 */
export const rawPromiseNodes = (node: ASTNode, key: string): (ASTNode | undefined)[] => {
  const value: unknown = Reflect.get(node, key);
  if (!Array.isArray(value)) {
    return [];
  }
  const items: readonly unknown[] = value;
  const nodes: (ASTNode | undefined)[] = [];
  for (const item of items) {
    nodes.push(asNode(item));
  }
  return nodes;
};

/**
 * Read an identifier or literal property name.
 *
 * @internal
 */
export const staticPromisePropertyName = (node: ASTNode | undefined): string | undefined => {
  const identifier = identifierName(node);
  if (identifier) {
    return identifier;
  }
  if (node?.type !== 'Literal') {
    return undefined;
  }
  const value: unknown = Reflect.get(node, 'value');
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  return undefined;
};

/**
 * Read a declaration key only when its runtime property name is static.
 *
 * @internal
 */
export const declaredPromisePropertyName = (property: ASTNode): string | undefined => {
  const key = childNode(property, 'key');
  if (Reflect.get(property, 'computed') === true && key?.type !== 'Literal') {
    return undefined;
  }
  return staticPromisePropertyName(key);
};
