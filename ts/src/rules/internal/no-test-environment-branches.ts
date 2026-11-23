import { defineRule } from '@oxlint/plugins';
import { Predicate } from 'effect';

import { isTestOrToolingFile } from './shared/test-paths';

import type { ESTree } from '@oxlint/plugins';

type Node = ESTree.Node;

const runnerKeys = new Set(['JEST_WORKER_ID', 'VITEST', 'VITEST_POOL_ID', 'VITEST_WORKER_ID']);
const testGlobals = new Set(['jest', 'vi', 'vitest']);
const comparisonOperators = new Set(['!=', '!==', '==', '===']);

const isTestLiteral = (node: Node | null | undefined): boolean =>
  node?.type === 'Literal' && node.value === 'test';

const keyName = (member: ESTree.MemberExpression): string | undefined => {
  if (!member.computed && member.property.type === 'Identifier') return member.property.name;
  return member.computed &&
    member.property.type === 'Literal' &&
    Predicate.isString(member.property.value)
    ? member.property.value
    : undefined;
};

const isNamedMember = (node: Node, objectName: string, property: string): boolean =>
  node.type === 'MemberExpression' &&
  node.object.type === 'Identifier' &&
  node.object.name === objectName &&
  keyName(node) === property;

const isProcessEnv = (node: Node): boolean => isNamedMember(node, 'process', 'env');

const isImportMetaEnv = (node: Node): boolean =>
  node.type === 'MemberExpression' &&
  node.object.type === 'MetaProperty' &&
  node.object.meta.name === 'import' &&
  keyName(node) === 'env';

const isComparedWithTest = (node: Node): boolean => {
  const parent = node.parent;
  if (parent?.type === 'BinaryExpression' && comparisonOperators.has(parent.operator)) {
    return isTestLiteral(parent.left === node ? parent.right : parent.left);
  }
  return (
    parent?.type === 'SwitchStatement' &&
    parent.discriminant === node &&
    parent.cases.some((switchCase) => isTestLiteral(switchCase.test))
  );
};

const isTestEnvironmentMember = (member: ESTree.MemberExpression): boolean => {
  const key = keyName(member);
  if (key === undefined) return false;
  if (isProcessEnv(member.object)) {
    return runnerKeys.has(key) || (key === 'NODE_ENV' && isComparedWithTest(member));
  }
  if (isImportMetaEnv(member.object)) {
    return runnerKeys.has(key) || (key === 'MODE' && isComparedWithTest(member));
  }
  return (
    member.object.type === 'Identifier' &&
    member.object.name === 'globalThis' &&
    testGlobals.has(key)
  );
};

const destructuredRunnerKeys = (declarator: ESTree.VariableDeclarator): Node[] => {
  if (declarator.id.type !== 'ObjectPattern' || declarator.init === null) return [];
  if (!isProcessEnv(declarator.init)) return [];
  return declarator.id.properties.filter(
    (property) =>
      property.type === 'Property' &&
      property.key.type === 'Identifier' &&
      runnerKeys.has(property.key.name),
  );
};

const isConfigRunnerKey = (call: ESTree.CallExpression): boolean => {
  const [first] = call.arguments;
  return (
    call.callee.type === 'MemberExpression' &&
    call.callee.object.type === 'Identifier' &&
    call.callee.object.name === 'Config' &&
    first?.type === 'Literal' &&
    Predicate.isString(first.value) &&
    runnerKeys.has(first.value)
  );
};

export const noTestEnvironmentBranchesRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow production code that detects the test runner, because it lets tests pass while production behavior differs.',
    },
    messages: {
      testEnvironmentBranch:
        'Production code must not detect the test runner. Checking NODE_ENV === "test", VITEST, JEST_WORKER_ID, or test globals makes code behave differently under tests, so passing tests stop proving production behavior. Pass the dependency or configuration in explicitly (with Effect, provide a test Layer).',
    },
  },
  createOnce(context) {
    let skip = false;
    const report = (node: Node): void => {
      if (!skip) context.report({ node, messageId: 'testEnvironmentBranch' });
    };
    return {
      before() {
        skip = isTestOrToolingFile(context.filename);
      },
      MemberExpression(node) {
        if (isTestEnvironmentMember(node)) report(node);
      },
      VariableDeclarator(node) {
        for (const property of destructuredRunnerKeys(node)) report(property);
      },
      CallExpression(node) {
        if (isConfigRunnerKey(node)) report(node);
      },
      UnaryExpression(node) {
        if (
          node.operator === 'typeof' &&
          node.argument.type === 'Identifier' &&
          testGlobals.has(node.argument.name)
        ) {
          report(node);
        }
      },
    };
  },
});
