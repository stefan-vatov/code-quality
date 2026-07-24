/* -------------------------------------------------------------------------- */
/*             Pattern declarations for Promise callable scopes.              */
/* -------------------------------------------------------------------------- */

import { childNode, childNodes, identifierName } from './effect-ast';
import type { ASTNode } from './effect-ast';
import type { FunctionBinding } from './effect-promise-callable-types';

const addWrappedPatternNames = (
  bindings: Map<string, FunctionBinding | undefined>,
  pattern: ASTNode,
): boolean => {
  if (pattern.type === 'AssignmentPattern') {
    addPatternNames(bindings, childNode(pattern, 'left'));
    return true;
  }
  if (pattern.type === 'RestElement') {
    addPatternNames(bindings, childNode(pattern, 'argument'));
    return true;
  }
  if (pattern.type === 'TSParameterProperty') {
    addPatternNames(bindings, childNode(pattern, 'parameter'));
    return true;
  }
  return false;
};

const addPatternElementName = (
  bindings: Map<string, FunctionBinding | undefined>,
  element: ASTNode,
): void => {
  if (element.type === 'Property') {
    addPatternNames(bindings, childNode(element, 'value'));
    return;
  }
  addPatternNames(bindings, element);
};

const addDestructuredPatternNames = (
  bindings: Map<string, FunctionBinding | undefined>,
  pattern: ASTNode,
): void => {
  let key = 'elements';
  if (pattern.type === 'ObjectPattern') {
    key = 'properties';
  }
  for (const element of childNodes(pattern, key)) {
    addPatternElementName(bindings, element);
  }
};

/**
 * Add every runtime binding introduced by one declaration pattern.
 *
 * @internal
 */
export const addPatternNames = (
  bindings: Map<string, FunctionBinding | undefined>,
  pattern: ASTNode | undefined,
): void => {
  if (!pattern) {
    return;
  }
  const name = identifierName(pattern);
  if (name) {
    bindings.set(name, undefined);
    return;
  }
  if (!addWrappedPatternNames(bindings, pattern)) {
    addDestructuredPatternNames(bindings, pattern);
  }
};
