import type { RuleSpec } from './effect-rule-core';
import { hasRunSyncInServerRequestHandler } from './effect-strict-internals';
import { runSyncServerHandlerAST } from './effect-strict-server-handler-ast';

export const effectStrictCoreSpecs: readonly RuleSpec[] = [
  {
    ast: runSyncServerHandlerAST,
    check: hasRunSyncInServerRequestHandler,
    message: 'Server handlers must not synchronously run Effects.',
    name: 'effect-no-runSync-in-server-request-handlers',
    tokens: ['runSync'],
  },
];
