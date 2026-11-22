import { defineRule } from '@oxlint/plugins';

export const noTryCatchThrowRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow try statements and throw statements.',
    },
    messages: {
      exceptionSyntax:
        'try/catch and throw are forbidden. Use Effect for error handling. Return Result (Either in Effect 3) for typed failures or Option when a value may be absent.',
    },
  },
  createOnce(context) {
    return {
      TryStatement(node) {
        context.report({ node, messageId: 'exceptionSyntax' });
      },
      ThrowStatement(node) {
        context.report({ node, messageId: 'exceptionSyntax' });
      },
    };
  },
});
