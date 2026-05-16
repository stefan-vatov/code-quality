import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import plugin from '../../src/rules/plugin.js';

type RuleName = keyof typeof plugin.rules;

type Report = {
  message: string;
  node: object;
};

const programNode = { type: 'Program', range: [0, 0] };

describe('file-level custom rules', () => {
  it.each([
    ['no-commented-out-code', '// const dead = true;\nexport const live = true;\n'],
    ['max-line-length', `${'x'.repeat(151)}\n`],
    ['require-file-doc', 'export const live = true;\n'],
    [
      'require-function-doc',
      '/** Module docs. */\nconst internal = true;\nexport function live() { return internal; }\n',
    ],
  ] satisfies Array<[RuleName, string]>)('reports %s on the Program node', (ruleName, source) => {
    const root = mkdtempSync(join(tmpdir(), 'thx-oxlint-rule-'));
    const filename = join(root, 'fixture.ts');
    const reports: Report[] = [];

    writeFileSync(filename, source);

    try {
      const visitors = plugin.rules[ruleName].create({
        filename,
        report(report: Report) {
          reports.push(report);
        },
      });

      visitors.Program?.(programNode);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }

    expect(reports[0]?.node).toBe(programNode);
  });
});
