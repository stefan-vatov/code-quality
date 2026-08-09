import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCodemodFixToSource, codemodFix } from '../../src/codemod-fix/index';

describe('codemodFix', () => {
  it('does not rewrite identifiers with the deleted acronym policy', () => {
    const source = 'const parseJson = (value: string): string => value;\n';

    expect(applyCodemodFixToSource(source)).toBe(source);
  });

  it('produces strict-lint-valid return annotations after composing arrow-body and return-type fixes', () => {
    const source = `/** @internal sample. */
const formatName = (name: string) => {
  return name.trim();
};

function parseJson(jsonValue: string): string {
  return jsonValue;
}

const label = (enabled: boolean): string => enabled ? 'on' : 'off';

const output = [formatName('Ada'), parseJson('{ }'), label(true)].join(':');
export { output };
`;

    expect(applyCodemodFixToSource(source)).toBe(`/**
 * sample.
 *
 * @internal
 */
const formatName = (name: string): string => name.trim();

const parseJson = (jsonValue: string): string => jsonValue;

const label = (enabled: boolean): string => {
  if (enabled) {
    return 'on';
  }
  return 'off';
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const output = [formatName('Ada'), parseJson('{ }'), label(true)].join(':');
`);
  });

  it('moves local export lists inline through the aggregate codemod fix', () => {
    const source = `const output = 'ready';

export { output };
`;

    expect(applyCodemodFixToSource(source)).toBe(`export const output = 'ready';

`);
  });

  it('adds internal declaration docs after moving local exports inline', () => {
    const source = `/** @internal sample. */
const output = 'ready';

export { output };
`;

    expect(applyCodemodFixToSource(source)).toBe(`/**
 * sample.
 *
 * @internal
 */
/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const output = 'ready';

`);
  });

  it('applies configured codemods under consumer-selected paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'thethracian-codemod-fix-'));

    try {
      mkdirSync(join(root, 'src'));
      mkdirSync(join(root, 'test'));
      const sourcePath = join(root, 'src', 'example.ts');
      const ignoredPath = join(root, 'test', 'example.ts');
      const source = 'function parseJson(jsonValue: string): string { return jsonValue; }\n';
      writeFileSync(sourcePath, source, 'utf8');
      writeFileSync(ignoredPath, source, 'utf8');

      const result = codemodFix({ cwd: root, paths: ['src'] });

      expect(result).toEqual({
        changedFiles: [sourcePath],
        scannedFiles: 1,
      });
      expect(readFileSync(sourcePath, 'utf8')).toBe(
        'const parseJson = (jsonValue: string): string => jsonValue;\n',
      );
      expect(readFileSync(ignoredPath, 'utf8')).toBe(source);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('reports pending changes without writing files in dry-run mode', () => {
    const root = mkdtempSync(join(tmpdir(), 'thethracian-codemod-fix-'));

    try {
      mkdirSync(join(root, 'src'));
      const sourcePath = join(root, 'src', 'example.ts');
      const source = 'function parseJson(jsonValue: string): string { return jsonValue; }\n';
      writeFileSync(sourcePath, source, 'utf8');

      const result = codemodFix({ cwd: root, dryRun: true, paths: ['src'] });

      expect(result).toEqual({
        changedFiles: [sourcePath],
        scannedFiles: 1,
      });
      expect(readFileSync(sourcePath, 'utf8')).toBe(source);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
