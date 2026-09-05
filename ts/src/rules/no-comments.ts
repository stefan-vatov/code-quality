import { defineRule } from '@oxlint/plugins';

export const noCommentsRule = defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Disallow comments in source code.' },
    messages: {
      comment: 'Comments are forbidden in source code. Put explanations in external documentation.',
    },
  },
  createOnce(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === 'Shebang') continue;
          context.report({ loc: comment.loc, messageId: 'comment' });
        }
      },
    };
  },
});
