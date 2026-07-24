/* -------------------------------------------------------------------------- */
/*           Object and array projection for invocation arguments.            */
/* -------------------------------------------------------------------------- */

import type {
  ArgumentValue,
  BoundArgument,
  ExecutionArguments,
  ParameterGetter,
} from './effect-promise-environment-types';
import { boundArgument, concreteArgument } from './effect-promise-environment-values';
import { childNode, childNodes, identifierName } from './effect-ast';
import { declaredPromisePropertyName, rawPromiseNodes } from './effect-promise-ast-values';
import type { ASTNode } from './effect-ast';
import type { FunctionBinding } from './effect-promise-callable-types';
import { unknownArgument } from './effect-promise-environment-types';

const absentProperty = Symbol('absentProperty');

/**
 * A statically projected property value and any getter executed by the read.
 *
 * @internal
 */
export interface PropertyRead {
  getter?: ParameterGetter;
  value: ArgumentValue;
}

type PropertyProjection = PropertyRead | typeof absentProperty;

const propertyRead = (value: ArgumentValue): PropertyRead => ({ value });

interface GetterEvaluation {
  environments: BoundArgument['environments'];
  helperScopes: BoundArgument['helperScopes'];
  values: Map<string, ArgumentValue>;
}

const getterEvaluation = (object: BoundArgument): GetterEvaluation => {
  const helperScope = new Map<string, FunctionBinding | undefined>();
  const values = new Map<string, ArgumentValue>();
  return {
    environments: [...object.environments, { helperScope, values }],
    helperScopes: [...object.helperScopes, helperScope],
    values,
  };
};

const bindGetterDeclarators = (
  declaration: ASTNode,
  object: BoundArgument,
  evaluation: GetterEvaluation,
): void => {
  for (const declarator of childNodes(declaration, 'declarations')) {
    const name = identifierName(childNode(declarator, 'id'));
    if (name) {
      evaluation.values.set(
        name,
        boundArgument(
          childNode(declarator, 'init'),
          object.scopes,
          evaluation.helperScopes,
          evaluation.environments,
        ),
      );
    }
  }
};

const getterReturn = (getter: ASTNode, object: BoundArgument): ArgumentValue => {
  const body = childNode(getter, 'body');
  if (!body) {
    return undefined;
  }
  const evaluation = getterEvaluation(object);
  for (const statement of childNodes(body, 'body')) {
    if (statement.type === 'VariableDeclaration') {
      bindGetterDeclarators(statement, object, evaluation);
    } else if (statement.type === 'ReturnStatement') {
      return boundArgument(
        childNode(statement, 'argument'),
        object.scopes,
        evaluation.helperScopes,
        evaluation.environments,
      );
    } else if (statement.type !== 'ExpressionStatement') {
      return unknownArgument;
    }
  }
  return undefined;
};

const getterIsAbrupt = (getter: ASTNode): boolean => {
  const body = childNode(getter, 'body');
  for (const statement of childNodes(body ?? getter, 'body')) {
    if (statement.type === 'ReturnStatement') {
      return false;
    }
    if (statement.type === 'ThrowStatement') {
      return true;
    }
  }
  return false;
};

const getterRead = (getter: ASTNode, object: BoundArgument): PropertyRead => {
  const binding: FunctionBinding = {
    helperScopes: object.helperScopes,
    node: getter,
    scopes: object.scopes,
  };
  return {
    getter: {
      binding,
      environments: object.environments,
      isAbrupt: getterIsAbrupt(getter),
    },
    value: getterReturn(getter, object),
  };
};

const matchedPropertyRead = (property: ASTNode, object: BoundArgument): PropertyRead => {
  const kind: unknown = Reflect.get(property, 'kind');
  const value = childNode(property, 'value');
  if (kind === 'get' && value) {
    return getterRead(value, object);
  }
  return propertyRead(
    boundArgument(value, object.scopes, object.helperScopes, object.environments),
  );
};

const isMatchingSetter = (property: ASTNode, propertyName: string): boolean =>
  property.type === 'Property' &&
  Reflect.get(property, 'kind') === 'set' &&
  declaredPromisePropertyName(property) === propertyName;

const projectionAfterSetter = (
  projected: PropertyProjection,
  hasTrailingSetter: boolean,
): PropertyProjection => {
  if (projected !== absentProperty && hasTrailingSetter && !projected.getter) {
    return propertyRead(undefined);
  }
  return projected;
};

const missingPropertyProjection = (hasSetter: boolean): PropertyProjection => {
  if (hasSetter) {
    return propertyRead(undefined);
  }
  return absentProperty;
};

const propertyValueFromObject = (
  object: BoundArgument,
  propertyName: string,
): PropertyProjection => {
  const properties = childNodes(object.node, 'properties');
  let hasTrailingSetter = false;
  for (let index = properties.length - 1; index >= 0; index -= 1) {
    const property = properties[index];
    if (property && isMatchingSetter(property, propertyName)) {
      hasTrailingSetter = true;
    } else if (property) {
      const projected = propertyProjection(property, object, propertyName);
      if (projected !== absentProperty) {
        return projectionAfterSetter(projected, hasTrailingSetter);
      }
    }
  }
  return missingPropertyProjection(hasTrailingSetter);
};

const spreadPropertyValue = (
  property: ASTNode,
  object: BoundArgument,
  propertyName: string,
): PropertyProjection => {
  const spread = boundArgument(
    childNode(property, 'argument'),
    object.scopes,
    object.helperScopes,
    object.environments,
  );
  const spreadObject = concreteArgument(spread);
  if (spreadObject?.node.type !== 'ObjectExpression') {
    return propertyRead(unknownArgument);
  }
  const projected = propertyValueFromObject(spreadObject, propertyName);
  if (projected === absentProperty || !object.isEvaluatedObject || !projected.getter) {
    return projected;
  }
  return propertyRead(projected.value);
};

const directPropertyValue = (
  property: ASTNode,
  object: BoundArgument,
  propertyName: string,
): PropertyProjection => {
  if (property.type !== 'Property') {
    return absentProperty;
  }
  const name = declaredPromisePropertyName(property);
  if (!name) {
    return propertyRead(unknownArgument);
  }
  if (name !== propertyName) {
    return absentProperty;
  }
  return matchedPropertyRead(property, object);
};

const propertyProjection = (
  property: ASTNode,
  object: BoundArgument,
  propertyName: string,
): PropertyProjection => {
  if (property.type === 'SpreadElement') {
    return spreadPropertyValue(property, object, propertyName);
  }
  return directPropertyValue(property, object, propertyName);
};

/**
 * Project one statically known object property from an abstract value.
 *
 * @internal
 */
export const objectPropertyRead = (value: ArgumentValue, propertyName: string): PropertyRead => {
  if (value === unknownArgument) {
    return propertyRead(unknownArgument);
  }
  const object = concreteArgument(value);
  if (object?.node.type !== 'ObjectExpression') {
    return propertyRead(unknownArgument);
  }
  const projected = propertyValueFromObject(object, propertyName);
  if (projected === absentProperty) {
    return propertyRead(undefined);
  }
  return projected;
};

const appendArrayElement = (
  values: ArgumentValue[],
  element: ASTNode | undefined,
  array: BoundArgument,
): boolean => {
  if (element?.type !== 'SpreadElement') {
    values.push(boundArgument(element, array.scopes, array.helperScopes, array.environments));
    return true;
  }
  const spread = boundArgument(
    childNode(element, 'argument'),
    array.scopes,
    array.helperScopes,
    array.environments,
  );
  const spreadArray = concreteArgument(spread);
  if (spreadArray?.node.type !== 'ArrayExpression') {
    return false;
  }
  const nested = arrayValues(spreadArray);
  values.push(...nested.values);
  return nested.isExact;
};

/**
 * Expand a statically known array expression until its cardinality is unknown.
 *
 * @internal
 */
export const arrayValues = (array: BoundArgument): ExecutionArguments => {
  const values: ArgumentValue[] = [];
  for (const element of rawPromiseNodes(array.node, 'elements')) {
    if (!appendArrayElement(values, element, array)) {
      return { isExact: false, values };
    }
  }
  return { isExact: true, values };
};
