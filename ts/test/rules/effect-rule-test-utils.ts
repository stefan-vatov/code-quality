import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { expect } from 'vitest';
import theThracianOxlint from '../../src/index';
import { effectDefaultRuleNames } from '../../src/rules/effect-rule-names';
import plugin from '../../src/rules/plugin';

type Report = {
  loc?: { column: number; line: number };
  message: string;
  node: object;
  ruleName?: string;
};

type RuleCase = {
  filename?: string;
  invalid: string;
  name: string;
  valid: string;
};

const programNode = { type: 'Program', range: [0, 0] };

const strictEffectTestPaths = {
  adapterLayers: ['src/adapters/**', 'src/platform/**', 'src/infrastructure/**'],
  compositionRoots: ['src/main.ts', 'src/server.ts', 'src/cli.ts', '**/*.entry.ts'],
  configLayers: ['src/config/**', 'src/layers/**', 'src/infrastructure/**'],
  domain: ['src/domain/**', 'src/core/**', 'src/features/**'],
  entrypoints: ['src/main.ts', 'src/server.ts', 'src/cli.ts', '**/*.entry.ts'],
  integrationTests: ['**/*.integration.test.ts', '**/*.integration.spec.ts'],
  unitTests: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.tsx', '**/*.spec.tsx'],
} as const;

type VisitorMap = Record<string, ((node: object) => void) | undefined>;

function isNode(value: unknown): value is { type: string } {
  return Boolean(
    value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string',
  );
}

function traverse(node: unknown, visitors: VisitorMap): void {
  if (!isNode(node)) {
    return;
  }

  if (node.type !== 'Program') {
    visitors[node.type]?.(node);
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        traverse(item, visitors);
      }
      continue;
    }
    traverse(value, visitors);
  }
}

function parseProgram(filename: string, source: string): object {
  return parseSync(filename, source, { sourceType: 'module' }).program as object;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function runRule(
  ruleName: string,
  source: string,
  filename = 'src/domain/user.ts',
  options?: object,
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
  options?: object,
  source = '',
): void {
  const rule = plugin.rules[ruleName as keyof typeof plugin.rules];
  expect(rule, `${ruleName} must be registered`).toBeDefined();
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

function runAllRules(source: string, filename = 'src/domain/user.ts', options?: object): Report[] {
  const root = mkdtempSync(join(tmpdir(), 'thx-effect-all-rules-'));
  const filePath = join(root, filename);
  const reports: Report[] = [];

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);

  try {
    for (const [ruleName, rule] of Object.entries(plugin.rules)) {
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

function ruleOptionsFromSetting(setting: unknown): object | undefined {
  if (!Array.isArray(setting)) {
    return undefined;
  }

  const [, options] = setting;
  return options && typeof options === 'object' ? options : undefined;
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
      const rule = plugin.rules[ruleName as keyof typeof plugin.rules];
      expect(rule, `${ruleName} must be registered`).toBeDefined();
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
  const strictOptions = Array.isArray(strictSetting) ? strictSetting[1] : undefined;
  const defaultRuleSetting = strictOptions ? ['error', strictOptions] : 'error';

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
  runAllRules,
  runConfiguredRules,
  runRule,
  runRuleAtPath,
  sorted,
  strictEffectTestPaths,
  withAllEffectRules,
};
export type { Report, RuleCase };
