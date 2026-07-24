/* -------------------------------------------------------------------------- */
/*        Straight-line execution prefix for eager Effect generators.         */
/* -------------------------------------------------------------------------- */

import { asNode, childNode, childNodes } from './effect-ast';
import { isFunctionNode, unwrappedExpression } from './effect-boundary-ast-shared';
import type { ASTNode } from './effect-ast';
import type { EffectResolutionBindings } from './effect-recursion-viability';
import type { ScopeStack } from './effect-ast-scope';
import { effectResolutionOf } from './effect-recursion-viability';

interface EagerGeneratorScan {
  bindings: EffectResolutionBindings;
  hasCompletedFacts: () => boolean;
  scan: (node: ASTNode) => void;
  scopes: ScopeStack;
}

const directYieldFor = (statement: ASTNode): ASTNode | undefined => {
  const expression = unwrappedExpression(childNode(statement, 'expression'));
  if (expression?.type === 'YieldExpression') {
    return expression;
  }
  return undefined;
};

const isStraightLineStatement = (statement: ASTNode): boolean =>
  statement.type === 'EmptyStatement' ||
  statement.type === 'ExpressionStatement' ||
  statement.type === 'FunctionDeclaration';

const appendNodeChildren = (node: ASTNode, pending: unknown[]): void => {
  for (const [key, child] of Object.entries(node)) {
    if (key !== 'parent') {
      pending.push(child);
    }
  }
};

const appendArrayValues = (value: readonly unknown[], pending: unknown[]): void => {
  for (const child of value) {
    pending.push(child);
  }
};

const nodeContainsYield = (node: ASTNode, pending: unknown[]): boolean => {
  if (node.type === 'YieldExpression') {
    return true;
  }
  if (!isFunctionNode(node)) {
    appendNodeChildren(node, pending);
  }
  return false;
};

const containsYieldCandidate = (value: unknown, pending: unknown[]): boolean => {
  if (Array.isArray(value)) {
    appendArrayValues(value as readonly unknown[], pending);
    return false;
  }
  const node = asNode(value);
  if (!node) {
    return false;
  }
  return nodeContainsYield(node, pending);
};

const containsYield = (value: unknown): boolean => {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    if (containsYieldCandidate(pending.pop(), pending)) {
      return true;
    }
  }
  return false;
};

const scanYield = (yielded: ASTNode, input: EagerGeneratorScan): boolean => {
  const effect = childNode(yielded, 'argument');
  if (effect) {
    input.scan(effect);
  }
  return effectResolutionOf(effect, input.bindings, input.scopes) === 'success';
};

const scanVariableDeclaration = (statement: ASTNode, input: EagerGeneratorScan): boolean => {
  for (const declaration of childNodes(statement, 'declarations')) {
    const initializer = unwrappedExpression(childNode(declaration, 'init'));
    if (initializer?.type === 'YieldExpression') {
      if (!scanYield(initializer, input)) {
        return false;
      }
    } else if (containsYield(initializer)) {
      return false;
    } else {
      input.scan(declaration);
    }
  }
  return true;
};

const scanReturnStatement = (statement: ASTNode, input: EagerGeneratorScan): void => {
  const returned = unwrappedExpression(childNode(statement, 'argument'));
  if (returned?.type === 'YieldExpression') {
    const effect = childNode(returned, 'argument');
    input.scan(effect ?? returned);
  } else if (!containsYield(returned)) {
    input.scan(statement);
  }
};

const scanOrdinaryStatement = (statement: ASTNode, input: EagerGeneratorScan): boolean => {
  const yielded = directYieldFor(statement);
  if (yielded) {
    return scanYield(yielded, input);
  }
  if (!isStraightLineStatement(statement) || containsYield(statement)) {
    return false;
  }
  input.scan(statement);
  return !input.hasCompletedFacts();
};

const scanGeneratorStatement = (statement: ASTNode, input: EagerGeneratorScan): boolean => {
  if (statement.type === 'ReturnStatement') {
    scanReturnStatement(statement, input);
    return false;
  }
  if (statement.type === 'VariableDeclaration') {
    return scanVariableDeclaration(statement, input);
  }
  return scanOrdinaryStatement(statement, input);
};

/**
 * Scan only the synchronously reachable prefix of an eager Effect generator.
 *
 * @internal
 */
export const scanEagerGeneratorPrefix = (body: ASTNode, input: EagerGeneratorScan): void => {
  for (const statement of childNodes(body, 'body')) {
    if (!scanGeneratorStatement(statement, input)) {
      return;
    }
  }
};
