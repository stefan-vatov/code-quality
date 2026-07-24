/* -------------------------------------------------------------------------- */
/*        Own properties carried by exact runtime callable identities.        */
/* -------------------------------------------------------------------------- */

import type { RuntimeCallableValue, RuntimeValue } from './effect-promise-runtime-model';

const callableProperties = new WeakMap<RuntimeCallableValue, Map<string, RuntimeValue>>();

/**
 * Read an own callable property if one was defined during exact execution.
 *
 * @internal
 */
export const readRuntimeCallableProperty = (
  callable: RuntimeCallableValue,
  name: string,
): RuntimeValue | undefined => callableProperties.get(callable)?.get(name);

/**
 * Determine whether an exact callable carries an own property.
 *
 * @internal
 */
export const hasRuntimeCallableProperty = (callable: RuntimeCallableValue, name: string): boolean =>
  callableProperties.get(callable)?.has(name) === true;

/**
 * Define an own property on one exact callable identity.
 *
 * @internal
 */
export const writeRuntimeCallableProperty = (
  callable: RuntimeCallableValue,
  name: string,
  value: RuntimeValue,
): void => {
  let properties = callableProperties.get(callable);
  if (!properties) {
    properties = new Map();
    callableProperties.set(callable, properties);
  }
  properties.set(name, value);
};
