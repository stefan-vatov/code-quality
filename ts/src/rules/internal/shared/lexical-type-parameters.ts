import type { ESTree } from '@oxlint/plugins';
import { Predicate } from 'effect';

type VisitorKeys = Readonly<Record<string, readonly string[]>>;

export type VisitorChildValue = ESTree.Node | readonly ESTree.Node[] | null | undefined;

interface VisitorFieldMap {
  readonly [key: string]: VisitorChildValue;
}

export type VisitorFields = ESTree.Node & VisitorFieldMap;

function isNode(value: unknown): value is ESTree.Node {
  return (
    Predicate.isObject(value) &&
    !Array.isArray(value) &&
    'type' in value &&
    Predicate.isString(value.type)
  );
}

function collectInferTypeParameterNames(
  node: ESTree.Node,
  visitorKeys: VisitorKeys,
  names: Set<string>,
): void {
  if (node.type === 'TSInferType') names.add(node.typeParameter.name.name);

  const record = node as VisitorFields;
  for (const key of visitorKeys[node.type] ?? []) {
    const value = record[key];
    if (isNode(value)) {
      collectInferTypeParameterNames(value, visitorKeys, names);
      continue;
    }
    if (!Array.isArray(value)) continue;
    for (const child of value) {
      if (isNode(child)) collectInferTypeParameterNames(child, visitorKeys, names);
    }
  }
}

function collectDeclaredTypeParameterNames(node: ESTree.Node, names: Set<string>): void {
  if (!('typeParameters' in node)) return;
  for (const parameter of node.typeParameters?.params ?? []) {
    names.add(parameter.name.name);
  }
}

export function lexicalTypeParameterNames(
  node: ESTree.Node,
  visitorKeys: VisitorKeys,
): ReadonlySet<string> {
  const names = new Set<string>();
  let descendant: ESTree.Node = node;
  let current: ESTree.Node | null = node;
  while (current !== null && current.type !== 'Program') {
    collectDeclaredTypeParameterNames(current, names);
    if (
      current.type === 'TSMappedType' &&
      (descendant === current.nameType || descendant === current.typeAnnotation)
    ) {
      names.add(current.key.name);
    }
    if (current.type === 'TSConditionalType' && descendant === current.trueType) {
      collectInferTypeParameterNames(current.extendsType, visitorKeys, names);
    }
    descendant = current;
    current = current.parent;
  }
  return names;
}
