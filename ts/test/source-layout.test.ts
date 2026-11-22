import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = join(import.meta.dirname, '..', 'src');

const entries = (directory: string): string[] =>
  readdirSync(join(sourceRoot, directory), { withFileTypes: true })
    .map((entry): string => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort();

describe('go-style internal source layout', (): void => {
  it('exposes only the package entry point and module directories at the source root', (): void => {
    expect(entries('.')).toEqual(['codemod-fix/', 'index.ts', 'internal/', 'rules/']);
  });

  it('keeps package-private modules shared by the entry point and rules in src/internal', (): void => {
    expect(entries('internal')).toEqual(['effect-rule-names.ts']);
  });

  it('exposes only the oxlint plugin entry from rules', (): void => {
    expect(entries('rules')).toEqual(['internal/', 'plugin.ts']);
  });

  it('exposes only the codemod API and CLI from codemod-fix', (): void => {
    expect(entries('codemod-fix')).toEqual(['cli.ts', 'index.ts', 'internal/']);
  });

  it('keeps every rule implementation module private to rules', (): void => {
    expect(entries('rules/internal')).toContain('effect-default.ts');
    expect(entries('rules/internal')).toContain('shared/');
  });

  it('keeps every codemod module private to codemod-fix', (): void => {
    expect(entries('codemod-fix/internal')).toContain('sort-imports.ts');
    expect(entries('codemod-fix/internal').every((name): boolean => name.endsWith('.ts'))).toBe(
      true,
    );
  });
});
