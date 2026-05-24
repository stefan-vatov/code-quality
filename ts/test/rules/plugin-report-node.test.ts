import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import plugin from '../../src/rules/plugin';

type RuleName = keyof typeof plugin.rules;

type Report = {
  fix?: (fixer: Fixer) => Fix | Array<Fix | null | undefined> | null | undefined;
  message: string;
  node: object;
};

const programNode = { type: 'Program', range: [0, 0] };

type Fix = {
  range: [number, number];
  text: string;
};

type Fixer = {
  removeRange(range: [number, number]): Fix;
  replaceTextRange(range: [number, number], text: string): Fix;
};

const fixer: Fixer = {
  removeRange(range: [number, number]): Fix {
    return { range, text: '' };
  },
  replaceTextRange(range: [number, number], text: string): Fix {
    return { range, text };
  },
};

describe('file-level custom rules', () => {
  it('declares no-commented-out-code as fixable for native Oxlint --fix', () => {
    expect(plugin.rules['no-commented-out-code'].meta).toStrictEqual({
      fixable: 'code',
      type: 'problem',
    });
  });

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

  it('reports the exact divider header format for missing file docs', () => {
    const root = mkdtempSync(join(tmpdir(), 'thx-oxlint-rule-'));
    const filename = join(root, 'fixture.ts');
    const reports: Report[] = [];

    writeFileSync(filename, 'export const live = true;\n');

    try {
      const visitors = plugin.rules['require-file-doc'].create({
        filename,
        report(report: Report) {
          reports.push(report);
        },
      });

      visitors.Program?.(programNode);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }

    expect(reports[0]?.message)
      .toBe(`Missing file-purpose header. Add a top-of-file divider header in this exact format:
/* -------------------------------------------------------------------------- */
/*                     Describe this file's purpose here.                     */
/* -------------------------------------------------------------------------- */

The text line must be a real description of what the file is for; declaration JSDoc does not count.`);
  });

  it('reports the exact public JSDoc shape for undocumented exports', () => {
    const root = mkdtempSync(join(tmpdir(), 'thx-oxlint-rule-'));
    const filename = join(root, 'fixture.ts');
    const reports: Report[] = [];

    writeFileSync(filename, 'export function live(input: string): string { return input; }\n');

    try {
      const visitors = plugin.rules['require-function-doc'].create({
        filename,
        report(report: Report) {
          reports.push(report);
        },
      });

      visitors.Program?.(programNode);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }

    expect(reports[0]?.message)
      .toBe(`Missing public declaration JSDoc. Add a /** ... */ block immediately above the export in this shape:
/**
 * Describe what this exported declaration does.
 *
 * @param name - Describe this parameter.
 * @returns Describe the return value.
 * @throws Describe expected error conditions, or state that it does not throw.
 */

The prose must be specific; generated placeholder text does not satisfy the rule.`);
  });

  it('offers a native fix that removes a commented-out line', () => {
    const root = mkdtempSync(join(tmpdir(), 'thx-oxlint-rule-'));
    const filename = join(root, 'fixture.ts');
    const reports: Report[] = [];

    writeFileSync(filename, '// const dead = true;\nexport const live = true;\n');

    try {
      const visitors = plugin.rules['no-commented-out-code'].create({
        filename,
        report(report: Report) {
          reports.push(report);
        },
      });

      visitors.Program?.(programNode);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }

    expect(reports).toHaveLength(1);
    expect(reports[0]?.fix?.(fixer)).toStrictEqual({ range: [0, 22], text: '' });
  });

  it('does not treat comment delimiters inside strings as fixable comments', () => {
    const root = mkdtempSync(join(tmpdir(), 'thx-oxlint-rule-'));
    const filename = join(root, 'fixture.ts');
    const reports: Report[] = [];

    writeFileSync(
      filename,
      "const marker = '/* @internal';\nconst close = '*/';\nconst line = '// const dead = true';\n",
    );

    try {
      const visitors = plugin.rules['no-commented-out-code'].create({
        filename,
        report(report: Report) {
          reports.push(report);
        },
      });

      visitors.Program?.(programNode);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }

    expect(reports).toEqual([]);
  });

  it('reports dynamic imports with emitted JavaScript extensions', () => {
    const reports: Report[] = [];
    const visitors = plugin.rules['no-dynamic-js-extension-imports'].create({
      report(report: Report) {
        reports.push(report);
      },
    });
    const importNode = {
      type: 'ImportExpression',
      source: {
        type: 'Literal',
        value: './feature.js',
      },
    };

    visitors.ImportExpression?.(importNode);

    expect(reports).toStrictEqual([
      {
        message:
          "Use extensionless TypeScript module specifiers instead of emitted JavaScript extension './feature.js'.",
        node: importNode,
      },
    ]);
  });

  it('reports package-subpath dynamic imports with emitted JavaScript extensions', () => {
    const reports: Report[] = [];
    const visitors = plugin.rules['no-dynamic-js-extension-imports'].create({
      report(report: Report) {
        reports.push(report);
      },
    });
    const importNode = {
      type: 'ImportExpression',
      source: {
        type: 'Literal',
        value: '@scope/package/feature.js',
      },
    };

    visitors.ImportExpression?.(importNode);

    expect(reports).toHaveLength(1);
  });

  it('reports CommonJS requires with emitted JavaScript extensions', () => {
    const reports: Report[] = [];
    const visitors = plugin.rules['no-dynamic-js-extension-imports'].create({
      report(report: Report) {
        reports.push(report);
      },
    });
    const requireNode = {
      type: 'CallExpression',
      arguments: [{ type: 'Literal', value: '../feature.js' }],
      callee: { name: 'require' },
    };

    visitors.CallExpression?.(requireNode);

    expect(reports).toHaveLength(1);
    expect(reports[0]?.node).toBe(requireNode);
  });

  it('allows extensionless dynamic TypeScript imports', () => {
    const reports: Report[] = [];
    const visitors = plugin.rules['no-dynamic-js-extension-imports'].create({
      report(report: Report) {
        reports.push(report);
      },
    });

    visitors.ImportExpression?.({
      type: 'ImportExpression',
      source: {
        type: 'Literal',
        value: './feature',
      },
    });

    expect(reports).toStrictEqual([]);
  });

  it('reports local export lists', () => {
    const reports: Report[] = [];
    const visitors = plugin.rules['no-local-export-list'].create({
      report(report: Report) {
        reports.push(report);
      },
    });
    const exportNode = {
      type: 'ExportNamedDeclaration',
      declaration: null,
      source: null,
      specifiers: [{ local: { name: 'helper' } }],
    };

    visitors.ExportNamedDeclaration?.(exportNode);

    expect(reports).toStrictEqual([
      {
        message:
          'Export declarations inline at their definition instead of using a local export list.',
        node: exportNode,
      },
    ]);
  });

  it('allows re-export lists from another module', () => {
    const reports: Report[] = [];
    const visitors = plugin.rules['no-local-export-list'].create({
      report(report: Report) {
        reports.push(report);
      },
    });

    visitors.ExportNamedDeclaration?.({
      type: 'ExportNamedDeclaration',
      declaration: null,
      source: { value: './other' },
      specifiers: [{ local: { name: 'helper' } }],
    });

    expect(reports).toStrictEqual([]);
  });
});

describe('identifier naming custom rules', () => {
  it('ignores destructuring variable declarators without crashing', () => {
    const reports: Report[] = [];
    const visitors = plugin.rules['camel-case-identifiers'].create({
      report(report: Report) {
        reports.push(report);
      },
    });

    expect(() => {
      visitors.VariableDeclarator?.({
        type: 'VariableDeclarator',
        id: {
          type: 'ObjectPattern',
          properties: [],
        },
        parent: {
          kind: 'const',
        },
      });
    }).not.toThrow();

    expect(reports).toEqual([]);
  });

  it('ignores destructuring declarators in acronym checks without crashing', () => {
    const reports: Report[] = [];
    const visitors = plugin.rules['acronym-case'].create({
      report(report: Report) {
        reports.push(report);
      },
    });

    expect(() => {
      visitors.VariableDeclarator?.({
        type: 'VariableDeclarator',
        id: {
          type: 'ArrayPattern',
          elements: [],
        },
        parent: {
          kind: 'const',
        },
      });
    }).not.toThrow();

    expect(reports).toEqual([]);
  });

  it('does not offer unsafe declaration-only acronym rename fixes', () => {
    const reports: Report[] = [];
    const visitors = plugin.rules['acronym-case'].create({
      report(report: Report) {
        reports.push(report);
      },
    });

    visitors.VariableDeclarator?.({
      type: 'VariableDeclarator',
      id: {
        name: 'parseUrl',
        range: [6, 14],
        type: 'Identifier',
      },
      parent: {
        kind: 'const',
      },
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]?.fix).toBeUndefined();
  });

  it('does not offer unsafe declaration-only boolean rename fixes', () => {
    const reports: Report[] = [];
    const visitors = plugin.rules['boolean-prefix'].create({
      report(report: Report) {
        reports.push(report);
      },
    });

    visitors.VariableDeclarator?.({
      type: 'VariableDeclarator',
      id: {
        name: 'enabled',
        range: [6, 13],
        type: 'Identifier',
      },
      init: {
        type: 'Literal',
        value: true,
      },
      parent: {
        kind: 'const',
      },
    });

    expect(reports).toHaveLength(1);
    expect(reports[0]?.fix).toBeUndefined();
  });
});
