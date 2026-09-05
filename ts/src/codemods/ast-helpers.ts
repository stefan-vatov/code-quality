import { Predicate } from 'effect';
import type { Node } from 'jscodeshift';

export interface CodemodRecord {
  readonly [key: string]: CodemodValue;
  readonly end?: number;
  readonly start?: number;
  readonly type: string;
}

export type CodemodValue =
  | boolean
  | null
  | number
  | string
  | undefined
  | Node
  | readonly CodemodValue[]
  | CodemodRecord;

export const codemodObjectValues = (node: CodemodRecord): readonly CodemodValue[] =>
  Object.keys(node).map((key): CodemodValue => node[key]);

export const isCodemodArray = (value: CodemodValue): value is readonly CodemodValue[] =>
  Array.isArray(value);

export const isCodemodNode = (value: CodemodValue): value is CodemodRecord =>
  Predicate.isObject(value) &&
  !Array.isArray(value) &&
  'type' in value &&
  Predicate.isString(value.type);

export const nodeStart = (node: Node | CodemodRecord): number => {
  const start = 'start' in node ? node.start : undefined;
  if (!Predicate.isNumber(start)) {
    throw new Error('jscodeshift node is missing a start offset');
  }
  return start;
};

export const nodeEnd = (node: Node | CodemodRecord): number => {
  const end = 'end' in node ? node.end : undefined;
  if (!Predicate.isNumber(end)) {
    throw new Error('jscodeshift node is missing an end offset');
  }
  return end;
};

export const sourceForNode = (source: string, node: Node | CodemodRecord): string =>
  source.slice(nodeStart(node), nodeEnd(node));
