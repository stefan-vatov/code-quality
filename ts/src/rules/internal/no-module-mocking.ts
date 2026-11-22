import { defineRule } from '@oxlint/plugins';
import { Predicate } from 'effect';

import type { ESTree, Scope, SourceCode, Variable } from '@oxlint/plugins';

const moduleMockMethods = new Set(['doMock', 'mock', 'unstable_mockModule']);

function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

function importedName(node: ESTree.Node): string | null {
  if (node.type === 'ImportNamespaceSpecifier') return '*';
  if (node.type !== 'ImportSpecifier') return null;
  return node.imported.type === 'Identifier' ? node.imported.name : node.imported.value;
}

function isTestFrameworkNamespaceMember(
  sourceCode: SourceCode,
  expression: ESTree.MemberExpression,
): boolean {
  const member = staticMemberName(expression);
  if (expression.object.type !== 'Identifier') return false;
  const variable = resolveVariable(sourceCode, expression.object);
  return (
    variable?.defs.some(
      (definition) =>
        definition.type === 'ImportBinding' &&
        definition.node.type === 'ImportNamespaceSpecifier' &&
        definition.parent?.type === 'ImportDeclaration' &&
        definition.parent.importKind !== 'type' &&
        ((definition.parent.source.value === 'vitest' && member === 'vi') ||
          (definition.parent.source.value === '@jest/globals' && member === 'jest')),
    ) ?? false
  );
}

function isTestFrameworkObject(sourceCode: SourceCode, expression: ESTree.Expression): boolean {
  if (expression.type === 'MemberExpression') {
    return isTestFrameworkNamespaceMember(sourceCode, expression);
  }
  if (expression.type !== 'Identifier') return false;
  if (
    (expression.name === 'vi' || expression.name === 'jest') &&
    sourceCode.isGlobalReference(expression)
  ) {
    return true;
  }

  const variable = resolveVariable(sourceCode, expression);
  if (variable === null || variable.defs.length === 0) {
    return expression.name === 'vi' || expression.name === 'jest';
  }
  return variable.defs.some((definition) => {
    if (definition.type !== 'ImportBinding' || definition.parent?.type !== 'ImportDeclaration') {
      return false;
    }
    if (
      definition.parent.importKind === 'type' ||
      (definition.node.type === 'ImportSpecifier' && definition.node.importKind === 'type')
    ) {
      return false;
    }
    const source = definition.parent.source.value;
    const name = importedName(definition.node);
    return (
      (source === 'vitest' && name === 'vi') || (source === '@jest/globals' && name === 'jest')
    );
  });
}

function staticMemberName(node: ESTree.MemberExpression): string | null {
  if (!node.computed) return node.property.type === 'Identifier' ? node.property.name : null;
  return node.property.type === 'Literal' && Predicate.isString(node.property.value)
    ? node.property.value
    : null;
}

function moduleMockCall(sourceCode: SourceCode, callee: ESTree.Expression): boolean {
  if (callee.type !== 'MemberExpression') return false;
  if (!isTestFrameworkObject(sourceCode, callee.object)) return false;
  const method = staticMemberName(callee);
  return method !== null && moduleMockMethods.has(method);
}

export const noModuleMockingRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Vitest and Jest module mocking; tests must replace dependencies through real interfaces.',
    },
    messages: {
      moduleMock:
        'Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.',
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === 'Super' || node.callee.type === 'V8IntrinsicExpression') return;
        if (moduleMockCall(context.sourceCode, node.callee)) {
          context.report({ node, messageId: 'moduleMock' });
        }
      },
    };
  },
});
