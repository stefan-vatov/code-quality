/* -------------------------------------------------------------------------- */
/*       Exact terminal memo for stateless Promise helper invocations.        */
/* -------------------------------------------------------------------------- */

import type { ExecutionArguments, ParameterEnvironments } from './effect-promise-environment-types';
import { COMPLETION_UNSAFE } from './effect-promise-completion';
import type { FunctionBinding } from './effect-promise-callable-types';
import type { PromiseEvaluation } from './effect-promise-completion';

const isStatelessInvocation = (
  argumentsList: ExecutionArguments,
  environments: ParameterEnvironments,
): boolean => {
  if (!argumentsList.isExact || argumentsList.values.length > 0) {
    return false;
  }
  for (const environment of environments) {
    if (environment.values.size > 0) {
      return false;
    }
  }
  return true;
};

/**
 * Cache only terminal unsafe results for provably stateless invocations.
 *
 * @internal
 */
export class PromiseInvocationMemo {
  readonly ordinaryUnsafe = new WeakSet();

  readonly generatorUnsafe = new WeakSet();

  completedSet(executeGeneratorBody: boolean): WeakSet<object> {
    if (executeGeneratorBody) {
      return this.generatorUnsafe;
    }
    return this.ordinaryUnsafe;
  }

  hasUnsafe(
    binding: FunctionBinding,
    argumentsList: ExecutionArguments,
    environments: ParameterEnvironments,
    executeGeneratorBody: boolean,
  ): boolean {
    if (!isStatelessInvocation(argumentsList, environments)) {
      return false;
    }
    return this.completedSet(executeGeneratorBody).has(binding.node);
  }

  complete(
    binding: FunctionBinding,
    argumentsList: ExecutionArguments,
    environments: ParameterEnvironments,
    executeGeneratorBody: boolean,
    result: PromiseEvaluation,
  ): PromiseEvaluation {
    if (
      result.completion === COMPLETION_UNSAFE &&
      isStatelessInvocation(argumentsList, environments)
    ) {
      this.completedSet(executeGeneratorBody).add(binding.node);
    }
    return result;
  }
}
