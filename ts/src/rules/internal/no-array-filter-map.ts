import { defineRule } from '@oxlint/plugins';
import { Option } from 'effect';

import {
  arrayMethodTarget,
  isKnownArrayExpression,
  unwrapArrayExpression,
} from './shared/array-method';

const pairedMethod = new Map([
  ['filter', 'map'],
  ['map', 'filter'],
]);

export const noArrayFilterMapRule = defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow adjacent eager array filter/map passes; use one pass or lazy iterator helpers.',
    },
    messages: {
      arrayFilterMap:
        'Avoid consecutive array `{{first}}` and `{{second}}` passes; each one allocates a full intermediate array. Use one pass instead: `Array.filterMap` from Effect, `flatMap`, or `.values().{{first}}(...).{{second}}(...).toArray()` where iterator helpers are supported. Preserve callback order, indexes, and filtering semantics.',
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const outer = Option.getOrNull(arrayMethodTarget(node.callee));
        if (outer === null) return;
        const expectedInner = pairedMethod.get(outer.name);
        const innerCall = unwrapArrayExpression(outer.object);
        if (expectedInner === undefined || innerCall.type !== 'CallExpression') return;
        const inner = Option.getOrNull(arrayMethodTarget(innerCall.callee));
        if (inner?.name !== expectedInner) return;
        if (!isKnownArrayExpression(context.sourceCode, inner.object)) return;
        context.report({
          node,
          messageId: 'arrayFilterMap',
          data: { first: inner.name, second: outer.name },
        });
      },
    };
  },
});
