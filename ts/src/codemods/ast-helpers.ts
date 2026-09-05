/* -------------------------------------------------------------------------- */
/*             Typed AST boundaries shared by package codemods.              */
/* -------------------------------------------------------------------------- */

import { Predicate } from 'effect';
import type { Node } from 'jscodeshift';

/** An AST-shaped record used when a codemod walks dynamic child properties. */
export interface CodemodRecord {
  readonly [key: string]: CodemodValue;
  readonly end?: number;
  readonly start?: number;
  readonly type: string;
}

/** Values that can occur while walking a jscodeshift AST node. */
export type CodemodValue =
  | boolean
  | null
  | number
  | string
  | undefined
  | Node
  | readonly CodemodValue[]
  | CodemodRecord;

/** Return the values of a traversed AST record without falling back to `any[]`. */
export const codemodObjectValues = (node: CodemodRecord): readonly CodemodValue[] =>
  Object.keys(node).map((key): CodemodValue => node[key]);

/** Narrow a dynamic AST value to the recursive array shape used by codemods. */
export const isCodemodArray = (value: CodemodValue): value is readonly CodemodValue[] =>
  Array.isArray(value);

/** Return whether a traversed value is an AST node with a string kind. */
export const isCodemodNode = (value: CodemodValue): value is CodemodRecord =>
  Predicate.isObject(value) &&
  !Array.isArray(value) &&
  'type' in value &&
  Predicate.isString(value.type);

/** Read a source offset from a parsed codemod node. */
export const nodeStart = (node: Node | CodemodRecord): number => {
  const start = 'start' in node ? node.start : undefined;
  if (!Predicate.isNumber(start)) {
    throw new Error('jscodeshift node is missing a start offset');
  }
  return start;
};

/** Read the exclusive source offset from a parsed codemod node. */
export const nodeEnd = (node: Node | CodemodRecord): number => {
  const end = 'end' in node ? node.end : undefined;
  if (!Predicate.isNumber(end)) {
    throw new Error('jscodeshift node is missing an end offset');
  }
  return end;
};

/** Slice the original source represented by a parsed codemod node. */
export const sourceForNode = (source: string, node: Node | CodemodRecord): string =>
  source.slice(nodeStart(node), nodeEnd(node));
