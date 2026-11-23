import { defineRule } from '@oxlint/plugins';

const minimumReasonWords = 4;

const protectedRules = new Set([
  'thethracian/require-disable-justification',
  'unicorn/no-abusive-eslint-disable',
]);

const genericLintWords = new Set([
  'disable',
  'eslint',
  'lint',
  'linter',
  'oxlint',
  'rule',
  'rules',
]);

const boilerplateReasonPatterns = [
  /\bfalse[\s-]*positives?\b/u,
  /\b(?:fix|clean\s*up|revisit|remove|address|handle)\b(?:\s+\S+){0,3}\s+later\b/u,
];

const directiveRuleNames = (value: string): string[] =>
  value.split(/[\s,]+/u).filter((token) => token !== '' && token !== '--');

const normalizedWord = (word: string): string =>
  word.toLowerCase().replaceAll(/[^a-z0-9@/-]/gu, '');

const ruleNameTokens = (ruleNames: readonly string[]): Set<string> =>
  new Set(
    ruleNames.flatMap((ruleName) => [
      ruleName.toLowerCase(),
      ...ruleName.toLowerCase().split(/[/-]/u),
    ]),
  );

const meaningfulWordCount = (reason: string, ruleNames: readonly string[]): number => {
  const ignored = ruleNameTokens(ruleNames);
  return reason
    .split(/\s+/u)
    .map(normalizedWord)
    .filter((word) => word !== '' && !ignored.has(word) && !genericLintWords.has(word)).length;
};

const isWeakReason = (reason: string, ruleNames: readonly string[]): boolean =>
  meaningfulWordCount(reason, ruleNames) < minimumReasonWords ||
  boilerplateReasonPatterns.some((pattern) => pattern.test(reason.toLowerCase()));

export const requireDisableJustificationRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every disable directive to explain, in at least four words, why the rule is wrong for that code.',
    },
    messages: {
      missingJustification:
        'Add ` -- <reason>` to this disable directive. In at least four words, state why the rule is wrong for this code and which invariant makes it safe. Prefer fixing the code so no directive is needed.',
      weakJustification:
        "This disable reason does not explain why the rule is wrong here. Write at least four words about this code; boilerplate such as 'false positive', 'fix later', 'needed', or the rule's own name is rejected. Prefer fixing the code.",
      protectedRule:
        'Do not disable `{{ruleName}}`. Suppression rules keep disable directives honest; fix the directive or the code instead.',
    },
  },
  createOnce(context) {
    return {
      Program() {
        for (const directive of context.sourceCode.getDisableDirectives().directives) {
          if (directive.type === 'enable') continue;
          const ruleNames = directiveRuleNames(directive.value);
          const disabledProtectedRule = ruleNames.find((ruleName) => protectedRules.has(ruleName));
          if (disabledProtectedRule !== undefined) {
            context.report({
              node: directive.node,
              messageId: 'protectedRule',
              data: { ruleName: disabledProtectedRule },
            });
            continue;
          }
          const reason = directive.justification.trim();
          if (reason === '') {
            context.report({ node: directive.node, messageId: 'missingJustification' });
          } else if (isWeakReason(reason, ruleNames)) {
            context.report({ node: directive.node, messageId: 'weakJustification' });
          }
        }
      },
    };
  },
});
