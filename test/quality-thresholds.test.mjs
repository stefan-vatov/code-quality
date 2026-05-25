import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const rootJSON = (path) =>
  JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8'));
const rootText = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');
const sourceFiles = (directory) =>
  readdirSync(new URL(`../${directory}`, import.meta.url), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => `${entry.parentPath}/${entry.name}`);

describe('quality threshold configuration', () => {
  it('keeps TypeScript source imports free of emitted JavaScript extensions', () => {
    const offenders = [...sourceFiles('ts/src'), ...sourceFiles('ts/test')].flatMap((path) => {
      const source = ts.createSourceFile(path, readFileSync(path, 'utf-8'), ts.ScriptTarget.Latest);
      const badSpecifiers = [];

      const checkNode = (node) => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          /^\.\.?\//u.test(node.moduleSpecifier.text) &&
          node.moduleSpecifier.text.endsWith('.js')
        ) {
          badSpecifiers.push(node.moduleSpecifier.text);
        }
        if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          ts.isStringLiteralLike(node.arguments[0]) &&
          node.arguments[0].text.endsWith('.js')
        ) {
          badSpecifiers.push(node.arguments[0].text);
        }
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'require' &&
          ts.isStringLiteralLike(node.arguments[0]) &&
          node.arguments[0].text.endsWith('.js')
        ) {
          badSpecifiers.push(node.arguments[0].text);
        }
        ts.forEachChild(node, checkNode);
      };

      checkNode(source);

      return badSpecifiers.map((specifier) => `${path}: ${specifier}`);
    });

    expect(offenders).toStrictEqual([]);
  });

  it('dogfoods the published TypeScript package entrypoint without local dist imports', () => {
    const packageJSON = rootJSON('package.json');
    const oxlintConfig = rootText('oxlint.config.mjs');

    expect(packageJSON.devDependencies['@thethracian/oxlint-config']).toBe('workspace:*');
    expect(oxlintConfig).toContain("from '@thethracian/oxlint-config'");
    expect(oxlintConfig).not.toContain('./ts/dist');
  });

  it('builds the workspace package before staged Oxlint package imports', () => {
    const packageJSON = rootJSON('package.json');
    const typeScriptCommands = packageJSON['lint-staged']['*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'];

    expect(typeScriptCommands[0]).toContain("sh -c 'pnpm --dir ts build && oxlint");
    expect(typeScriptCommands[0]).toContain('"$@"');
  });

  it('documents a clean consumer lint-staged setup for packaged TypeScript fixes', () => {
    const readme = rootText('ts/README.md');

    expect(readme).toContain(
      '"lint:fix": "thx-codemod-fix src && oxlint src --fix && thx-codemod-fix src"',
    );
    expect(readme).toContain(
      '"lint:fix:type-aware": "thx-codemod-fix src && oxlint src --type-aware --type-check --fix && thx-codemod-fix src"',
    );
    expect(readme).toContain('"lint-staged": {');
    expect(readme).toContain('"*.{ts,tsx,mts,cts}": [');
    expect(readme).toContain('"thx-codemod-fix"');
    expect(readme).toContain(
      '"oxlint --type-aware --type-check --fix --no-error-on-unmatched-pattern"',
    );
  });

  it('keeps published TypeScript README focused on consumers, not monorepo dogfooding', () => {
    const readme = rootText('ts/README.md');

    expect(readme).not.toMatch(
      /dogfood|workspace copy|monorepo has an extra local package build step/u,
    );
  });

  it('enforces coverage watermarks for the TypeScript package source', () => {
    const config = rootText('vitest.config.mts');

    expect(config).toContain("include: ['ts/src/**/*.ts']");
    expect(config).toContain('lines: 80');
    expect(config).toContain('functions: 80');
    expect(config).toContain('branches: 75');
    expect(config).toContain('statements: 80');
  });

  it('excludes Stryker sandboxes from normal Vitest runs', () => {
    const config = rootText('vitest.config.mts');

    expect(config).toContain("'**/.stryker-tmp/**'");
  });

  it('fails mutation runs below the configured break threshold', () => {
    const config = rootJSON('stryker.config.json');

    expect(config.thresholds).toStrictEqual({
      break: 80,
      high: 90,
      low: 80,
    });
  });

  it('mutates the TypeScript package source without stale package globs', () => {
    const config = rootJSON('stryker.config.json');

    expect(config.mutate).toStrictEqual(['ts/src/**/*.{cjs,mjs,js,ts,mts,cts,jsx,tsx}']);
    expect(config.mutate).not.toContain('cli/src/**/*.{cjs,mjs,js,ts,mts,cts,jsx,tsx}');
  });

  it('keeps mutation sandboxes away from generated workspace caches', () => {
    const config = rootJSON('stryker.config.json');

    expect(config.ignorePatterns).toEqual(
      expect.arrayContaining([
        '/coverage',
        '/dist',
        '/.nx',
        '/elixir/_build',
        '/rust/target',
        '/ts/dist',
      ]),
    );
  });

  it('excludes source-shape invariant tests from mutation runs', () => {
    const config = rootJSON('stryker.config.json');
    const vitestConfig = rootText('vitest.stryker.config.mts');

    expect(config.vitest.configFile).toBe('vitest.stryker.config.mts');
    expect(vitestConfig).toContain("'ts/test/rules/*performance.test.ts'");
    expect(vitestConfig).toContain("'ts/test/rules/effect-default-bucket-cases.test.ts'");
    expect(vitestConfig).toContain("'ts/test/rules/require-function-doc.test.ts'");
    expect(vitestConfig).toContain("'ts/test/rules/max-line-length.test.ts'");
  });
});
