import { defineRule } from '@oxlint/plugins';

import type { ESTree } from '@oxlint/plugins';

type Node = ESTree.Node;

const equalityMatchers = new Set(['toBe', 'toEqual', 'toStrictEqual']);
const unaryMatchers = new Set([
  'toBeDefined',
  'toBeFalsy',
  'toBeNaN',
  'toBeNull',
  'toBeTruthy',
  'toBeUndefined',
]);
const singleValueAsserts = new Set([
  'isDefined',
  'isFalse',
  'isNotNull',
  'isNotOk',
  'isNull',
  'isOk',
  'isTrue',
  'isUndefined',
  'ok',
]);
const pairAsserts = new Set([
  'deepEqual',
  'deepStrictEqual',
  'equal',
  'notDeepEqual',
  'notDeepStrictEqual',
  'notEqual',
  'notStrictEqual',
  'strictEqual',
]);
const constantIdentifiers = new Set(['Infinity', 'NaN', 'undefined']);
type TransparentWrapper =
  | ESTree.ParenthesizedExpression
  | ESTree.TSAsExpression
  | ESTree.TSNonNullExpression
  | ESTree.TSSatisfiesExpression;

const transparentWrappers = new Set<string>([
  'ParenthesizedExpression',
  'TSAsExpression',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
]);

const isTransparentWrapper = (node: Node): node is TransparentWrapper =>
  transparentWrappers.has(node.type);

function unwrap(node: Node): Node {
  let current = node;
  while (isTransparentWrapper(current)) {
    current = current.expression;
  }
  return current;
}

function isConstantProperty(property: Node): boolean {
  return (
    property.type === 'Property' &&
    property.kind === 'init' &&
    !property.method &&
    (!property.computed || isConstant(property.key)) &&
    isConstant(property.value)
  );
}

function isConstantContainer(node: Node): boolean {
  if (node.type === 'ArrayExpression') {
    return node.elements.every(
      (element) => element !== null && element.type !== 'SpreadElement' && isConstant(element),
    );
  }
  return node.type === 'ObjectExpression' && node.properties.every(isConstantProperty);
}

function isConstantOperator(node: Node): boolean {
  if (node.type === 'UnaryExpression')
    return node.operator !== 'delete' && isConstant(node.argument);
  if (node.type === 'BinaryExpression') {
    return (
      node.left.type !== 'PrivateIdentifier' && isConstant(node.left) && isConstant(node.right)
    );
  }
  return node.type === 'LogicalExpression' && isConstant(node.left) && isConstant(node.right);
}

function isConstant(node: Node): boolean {
  const value = unwrap(node);
  if (value.type === 'Literal') return true;
  if (value.type === 'TemplateLiteral') return value.expressions.length === 0;
  if (value.type === 'Identifier') return constantIdentifiers.has(value.name);
  return isConstantOperator(value) || isConstantContainer(value);
}

function memberChain(node: Node): string | undefined {
  const value = unwrap(node);
  if (value.type === 'Identifier' && !constantIdentifiers.has(value.name)) return value.name;
  if (value.type === 'ThisExpression') return 'this';
  if (value.type !== 'MemberExpression') return undefined;
  const object = memberChain(value.object);
  if (object === undefined) return undefined;
  if (!value.computed && value.property.type === 'Identifier') {
    return `${object}.${value.property.name}`;
  }
  return value.computed && value.property.type === 'Literal'
    ? `${object}[${String(value.property.value)}]`
    : undefined;
}

function isSameChain(left: Node, right: Node): boolean {
  const leftChain = memberChain(left);
  return leftChain !== undefined && leftChain === memberChain(right);
}

function comparesNothing(left: Node | undefined, right: Node | undefined): boolean {
  if (left === undefined || right === undefined) return false;
  return (isConstant(left) && isConstant(right)) || isSameChain(left, right);
}

function argumentAt(call: ESTree.CallExpression, index: number): Node | undefined {
  const argument = call.arguments[index];
  return argument === undefined || argument.type === 'SpreadElement' ? undefined : argument;
}

function propertyName(node: Node): string | undefined {
  return node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier'
    ? node.property.name
    : undefined;
}

function isExpectCallee(node: Node): boolean {
  if (node.type === 'Identifier') return node.name === 'expect';
  return (
    node.type === 'MemberExpression' &&
    node.object.type === 'Identifier' &&
    node.object.name === 'expect' &&
    propertyName(node) === 'soft'
  );
}

function expectSubject(node: Node): Node | undefined {
  const target =
    propertyName(node) === 'not' && node.type === 'MemberExpression' ? node.object : node;
  return target.type === 'CallExpression' && isExpectCallee(target.callee)
    ? argumentAt(target, 0)
    : undefined;
}

function isTautologicalMatcher(call: ESTree.CallExpression): boolean {
  const matcher = propertyName(call.callee);
  if (matcher === undefined || call.callee.type !== 'MemberExpression') return false;
  const subject = expectSubject(call.callee.object);
  if (subject === undefined) return false;
  if (unaryMatchers.has(matcher)) return isConstant(subject);
  return equalityMatchers.has(matcher) && comparesNothing(subject, argumentAt(call, 0));
}

function isAssertObject(node: Node): boolean {
  return node.type === 'Identifier' && node.name === 'assert';
}

function isTautologicalAssert(call: ESTree.CallExpression): boolean {
  const first = argumentAt(call, 0);
  if (isAssertObject(call.callee)) return first !== undefined && isConstant(first);
  if (call.callee.type !== 'MemberExpression' || !isAssertObject(call.callee.object)) return false;
  const method = propertyName(call.callee);
  if (method === undefined) return false;
  if (singleValueAsserts.has(method)) return first !== undefined && isConstant(first);
  return pairAsserts.has(method) && comparesNothing(first, argumentAt(call, 1));
}

export const noTautologicalAssertionsRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow assertions that compare constants or a value with itself, because they pass without exercising the code under test.',
    },
    messages: {
      tautologicalAssertion:
        'This assertion compares constants or a value with itself, so its result never depends on the code under test. Assert on what the code produces, for example `expect(compute(input)).toBe(expected)`.',
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (isTautologicalMatcher(node) || isTautologicalAssert(node)) {
          context.report({ node, messageId: 'tautologicalAssertion' });
        }
      },
    };
  },
});
