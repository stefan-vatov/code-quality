import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { Predicate } from 'effect';
import { expect } from 'vitest';
import theThracianOxlint from '../../src/index';
import { isASTArray, isASTNode } from '../../src/rules/effect-ast';
import type { ASTNode, ASTValue } from '../../src/rules/effect-ast';
import type { StrictPathOptions } from '../../src/rules/effect-path-options';
import type { Context, SourceRule, VisitorMap } from '../../src/rules/effect-rule-core';
import { effectDefaultRuleNames } from '../../src/rules/effect-rule-names';
import plugin from '../../src/rules/plugin';

type Report = Parameters<Context['report']>[0] & {
  ruleName?: string;
};

type RuleSetting = NonNullable<ReturnType<typeof theThracianOxlint>['rules']>[string];

type RuleCase = {
  filename?: string;
  invalid: string;
  name: string;
  valid: string;
};

const programNode: ASTNode = { type: 'Program', range: [0, 0] };

const strictEffectTestPaths = {
  adapterLayers: ['src/adapters/**', 'src/platform/**', 'src/infrastructure/**'],
  compositionRoots: ['src/main.ts', 'src/server.ts', 'src/cli.ts', '**/*.entry.ts'],
  configLayers: ['src/config/**', 'src/layers/**', 'src/infrastructure/**'],
  domain: ['src/domain/**', 'src/core/**', 'src/features/**'],
  entrypoints: ['src/main.ts', 'src/server.ts', 'src/cli.ts', '**/*.entry.ts'],
  integrationTests: ['**/*.integration.test.ts', '**/*.integration.spec.ts'],
  unitTests: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.tsx', '**/*.spec.tsx'],
} as const;

function traverse(node: ASTValue, visitors: VisitorMap): void {
  if (!isASTNode(node)) {
    return;
  }

  if (node.type !== 'Program') {
    visitors[node.type]?.(node);
  }

  for (const value of Object.values(node)) {
    if (isASTArray(value)) {
      for (const item of value) {
        traverse(item, visitors);
      }
      continue;
    }
    traverse(value, visitors);
  }
}

function effectProgram(program: ReturnType<typeof parseSync>['program'] | ASTNode): ASTNode {
  // SAFETY: Oxc produces ESTree nodes with string type tags and enumerable child fields;
  // the Effect AST readers use that same structural contract without native host metadata.
  return program as ASTNode;
}

function parseProgram(filename: string, source: string): ASTNode {
  return effectProgram(parseSync(filename, source, { sourceType: 'module' }).program);
}

function effectSourceRule(rule: (typeof plugin.rules)[string] | SourceRule): SourceRule {
  // SAFETY: these tests select registered Effect rules, whose SourceRule create/context
  // contract is preserved at runtime by eslintCompatPlugin's native type adapter.
  return rule as SourceRule;
}

function getEffectRule(ruleName: string): SourceRule {
  const rule = plugin.rules[ruleName];
  expect(rule, `${ruleName} must be registered`).toBeDefined();
  return effectSourceRule(rule);
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function runRule(
  ruleName: string,
  source: string,
  filename = 'src/domain/user.ts',
  options?: StrictPathOptions,
): Report[] {
  const root = mkdtempSync(join(tmpdir(), 'thx-effect-bucket-rule-'));
  const filePath = join(root, filename);
  const reports: Report[] = [];

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);

  try {
    runRuleAtPath(ruleName, filePath, reports, options, source);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }

  return reports;
}

function runRuleAtPath(
  ruleName: string,
  filePath: string,
  reports: Report[],
  options?: StrictPathOptions,
  source = '',
): void {
  const rule = getEffectRule(ruleName);
  const visitors = rule.create({
    filename: filePath,
    options: options ? [options] : [],
    report(report: Report) {
      reports.push(report);
    },
  });

  const ast = source ? parseProgram(filePath, source) : programNode;
  visitors.Program?.(ast);
  traverse(ast, visitors);
}

function runAllRules(
  source: string,
  filename = 'src/domain/user.ts',
  options?: StrictPathOptions,
): Report[] {
  const root = mkdtempSync(join(tmpdir(), 'thx-effect-all-rules-'));
  const filePath = join(root, filename);
  const reports: Report[] = [];

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);

  try {
    for (const ruleName of Object.keys(plugin.rules)) {
      if (!ruleName.startsWith('effect-')) {
        continue;
      }

      const visitors = getEffectRule(ruleName).create({
        filename: filePath,
        options: options ? [options] : [],
        report(report: Report) {
          reports.push({ ...report, ruleName });
        },
      });

      const ast = parseProgram(filePath, source);
      visitors.Program?.(ast);
      traverse(ast, visitors);
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }

  return reports;
}

function ruleOptionsFromSetting(setting: RuleSetting | undefined): StrictPathOptions | undefined {
  if (!Array.isArray(setting)) {
    return undefined;
  }

  const [, options] = setting;
  if (!Predicate.isRecord(options)) {
    return undefined;
  }
  // SAFETY: the config factory emits StrictPathOptions for configured Effect rules;
  // Oxlint's generic rule setting type erases that package-owned option contract.
  return options as StrictPathOptions;
}

function runConfiguredRules(
  config: ReturnType<typeof theThracianOxlint>,
  source: string,
  filename = 'src/domain/user.ts',
): Report[] {
  const root = mkdtempSync(join(tmpdir(), 'thx-effect-config-rules-'));
  const filePath = join(root, filename);
  const reports: Report[] = [];

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);

  try {
    for (const [fullRuleName, setting] of Object.entries(config.rules ?? {})) {
      if (!fullRuleName.startsWith('thethracian/effect-')) {
        continue;
      }

      const ruleName = fullRuleName.replace(/^thethracian\//, '');
      const rule = getEffectRule(ruleName);
      const options = ruleOptionsFromSetting(setting);
      const visitors = rule.create({
        filename: filePath,
        options: options ? [options] : [],
        report(report: Report) {
          reports.push({ ...report, ruleName });
        },
      });

      const ast = parseProgram(filePath, source);
      visitors.Program?.(ast);
      traverse(ast, visitors);
    }
  } finally {
    rmSync(root, { force: true, recursive: true });
  }

  return reports;
}

/**
 * Builds a test-only profile that explicitly selects every registered Effect rule.
 * The published config intentionally enables only the safety bucket by default;
 * implementation coverage must opt into the remaining rules rather than silently
 * treating them as part of the consumer preset.
 */
function withAllEffectRules(
  config: ReturnType<typeof theThracianOxlint>,
): ReturnType<typeof theThracianOxlint> {
  const strictSetting = config.rules?.['thethracian/effect-no-run-outside-entrypoints'];
  const strictOptions = ruleOptionsFromSetting(strictSetting);
  const defaultRuleSetting: RuleSetting = strictOptions ? ['error', strictOptions] : 'error';

  return {
    ...config,
    rules: {
      ...config.rules,
      ...Object.fromEntries(
        effectDefaultRuleNames.map((ruleName) => [`thethracian/${ruleName}`, defaultRuleSetting]),
      ),
    },
  };
}

export {
  getEffectRule,
  runAllRules,
  runConfiguredRules,
  runRule,
  runRuleAtPath,
  sorted,
  strictEffectTestPaths,
  withAllEffectRules,
};
export type { Report, RuleCase };
