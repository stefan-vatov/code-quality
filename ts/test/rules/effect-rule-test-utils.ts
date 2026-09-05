import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { expect } from 'vitest';
import theThracianOxlint from '../../src/index';
import type { ASTNode, ASTValue } from '../../src/rules/effect-ast';
import { isASTArray, isASTNode } from '../../src/rules/effect-ast';
import type { Context, SourceRule, VisitorMap } from '../../src/rules/effect-rule-core';
import plugin from '../../src/rules/plugin';

type Report = Parameters<Context['report']>[0] & {
  ruleName?: string;
};

type RuleCase = {
  filename?: string;
  invalid: string;
  name: string;
  valid: string;
};

const programNode: ASTNode = { type: 'Program', range: [0, 0] };

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
  return program as ASTNode;
}

function parseProgram(filename: string, source: string): ASTNode {
  return effectProgram(parseSync(filename, source, { sourceType: 'module' }).program);
}

function effectSourceRule(rule: (typeof plugin.rules)[string] | SourceRule): SourceRule {
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

function runRule(ruleName: string, source: string, filename = 'src/domain/user.ts'): Report[] {
  const root = mkdtempSync(join(tmpdir(), 'thx-effect-bucket-rule-'));
  const filePath = join(root, filename);
  const reports: Report[] = [];

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);

  try {
    runRuleAtPath(ruleName, filePath, reports, source);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }

  return reports;
}

function runRuleAtPath(ruleName: string, filePath: string, reports: Report[], source = ''): void {
  const rule = getEffectRule(ruleName);
  const visitors = rule.create({
    filename: filePath,
    report(report: Report) {
      reports.push(report);
    },
  });

  const ast = source ? parseProgram(filePath, source) : programNode;
  visitors.Program?.(ast);
  traverse(ast, visitors);
}

function runAllRules(source: string, filename = 'src/domain/user.ts'): Report[] {
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
    for (const fullRuleName of Object.keys(config.rules ?? {})) {
      if (!fullRuleName.startsWith('thethracian/effect-')) {
        continue;
      }

      const ruleName = fullRuleName.replace(/^thethracian\//, '');
      const rule = getEffectRule(ruleName);
      const visitors = rule.create({
        filename: filePath,
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

export { getEffectRule, runAllRules, runConfiguredRules, runRule, runRuleAtPath, sorted };
export type { Report, RuleCase };
