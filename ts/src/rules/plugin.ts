import { readFileSync } from 'node:fs';
import isCommentedOutCode from './no-commented-out-code.js';

/**
 * Oxlint plugin for The Thracian custom rules.
 *
 * Rules:
 * - `no-commented-out-code`: Forbids commented-out source code in comments.
 */
const noCommentedOutCodeRule = {
  create(context: {
    report: (descriptor: { message: string; loc: { line: number; column: number } }) => void;
    filename: string;
  }) {
    return {
      Program() {
        let source: string | undefined = undefined;
        try {
          source = readFileSync(context.filename, 'utf-8');
        } catch {
          return;
        }
        if (!source) {
          return;
        }

        const lines = source.split('\n');

        // Check single-line comments: // ...
        const singleLineRe = /\/\/\s*(.+)$/;
        for (let idx = 0; idx < lines.length; idx++) {
          const match = singleLineRe.exec(lines[idx]);
          if (match && isCommentedOutCode(match[1])) {
            context.report({
              message: 'Commented-out code found. Remove it instead of commenting it out.',
              loc: { line: idx + 1, column: lines[idx].indexOf('//') + 1 },
            });
          }
        }

        // Check multi-line comments: /* ... */
        const fullSource = source;
        const multiLineRe = /\/\*\s*([\s\S]*?)\s*\*\//g;
        let match: RegExpExecArray | null = null;
        while ((match = multiLineRe.exec(fullSource)) !== null) {
          const [, body] = match;
          if (isCommentedOutCode(body)) {
            // Calculate line number from match position
            const beforeMatch = fullSource.slice(0, match.index);
            const line = (beforeMatch.match(/\n/g) || []).length + 1;
            context.report({
              message: 'Commented-out code found. Remove it instead of commenting it out.',
              loc: { line, column: 1 },
            });
          }
        }
      },
    };
  },
};

const plugin = {
  meta: {
    name: 'thethracian',
  },
  rules: {
    'no-commented-out-code': noCommentedOutCodeRule,
  },
};

export default plugin;
