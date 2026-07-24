/* -------------------------------------------------------------------------- */
/*         Runtime task execution adapter for Promise rule reporting.         */
/* -------------------------------------------------------------------------- */

import type { PromiseRuntimeTasks, PromiseTaskExecutionSite } from './effect-promise-runtime-tasks';
import type { ASTNode } from './effect-ast';
import type { HelperScopes } from './effect-promise-callable-types';
import { executePromiseRunCall } from './effect-promise-runtime-tasks';

/**
 * One callback that analyzes an Effect.sync task at a proven run site.
 *
 * @internal
 */
export type PromiseRuntimeReporter = (
  syncCall: ASTNode,
  site: PromiseTaskExecutionSite,
  helperScopes: HelperScopes,
) => boolean;

/**
 * Analyze one indexed runtime task without exposing offset restoration to the rule.
 *
 * @internal
 */
export const reportPromiseRuntimeTask = (
  tasks: PromiseRuntimeTasks | undefined,
  runCall: ASTNode,
  report: PromiseRuntimeReporter,
): readonly ASTNode[] =>
  executePromiseRunCall(tasks, runCall, report).map(({ syncCall }): ASTNode => syncCall);
