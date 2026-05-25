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

  it('uses the published TypeScript package entrypoint like a consumer project', () => {
    const packageJSON = rootJSON('package.json');
    const oxlintConfig = rootText('oxlint.config.mjs');

    expect(packageJSON.devDependencies['@thethracian/oxlint-config']).toBe(
      'npm:@thethracian/oxlint-config@0.3.0',
    );
    expect(oxlintConfig).toContain("from '@thethracian/oxlint-config'");
    expect(oxlintConfig).not.toMatch(/workspace copy|local dist/u);
    expect(oxlintConfig).not.toContain('./ts/dist');
  });

  it('uses the published package CLI and Oxlint directly for staged TypeScript fixes', () => {
    const packageJSON = rootJSON('package.json');
    const typeScriptCommands = packageJSON['lint-staged']['*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'];

    expect(packageJSON.scripts['codemod:ts']).toBe('thx-codemod-fix ts/src');
    expect(packageJSON.scripts.lint).toBe('oxlint -c oxlint.config.mjs ts');
    expect(packageJSON.scripts['lint:type-aware']).toBe(
      'oxlint -c oxlint.config.mjs ts --type-aware --type-check',
    );
    expect(typeScriptCommands).toStrictEqual([
      'thx-codemod-fix',
      'oxlint -c oxlint.config.mjs --type-aware --type-check --fix --no-error-on-unmatched-pattern',
      'thx-codemod-fix',
      'oxfmt',
    ]);
  });

  it('keeps workspace TypeScript config checks behind explicit local development scripts', () => {
    const packageJSON = rootJSON('package.json');
    const publishedConfig = rootText('oxlint.config.mjs');
    const localConfig = rootText('oxlint.workspace.config.mjs');

    expect(packageJSON.scripts['codemod:ts:local']).toBe('tsx ts/src/codemod-fix/cli.ts ts/src');
    expect(packageJSON.scripts['lint:local']).toBe(
      'pnpm --dir ts build && oxlint -c oxlint.workspace.config.mjs ts',
    );
    expect(packageJSON.scripts['lint:local:type-aware']).toBe(
      'pnpm --dir ts build && oxlint -c oxlint.workspace.config.mjs ts --type-aware --type-check',
    );
    expect(packageJSON.scripts['lint:local:fix']).toBe(
      'pnpm run codemod:ts:local && pnpm --dir ts build && oxlint -c oxlint.workspace.config.mjs ts --fix && pnpm run codemod:ts:local',
    );
    expect(packageJSON.scripts['lint:local:type-aware:fix']).toBe(
      'pnpm run codemod:ts:local && pnpm --dir ts build && oxlint -c oxlint.workspace.config.mjs ts --type-aware --type-check --fix && pnpm run codemod:ts:local',
    );
    expect(localConfig).toContain("from './ts/dist/index.js'");
    expect(localConfig).not.toContain("from '@thethracian/oxlint-config'");
    expect(publishedConfig).toContain("'oxlint.workspace.config.mjs'");
    expect(packageJSON.scripts.lint).toBe('oxlint -c oxlint.config.mjs ts');
    expect(packageJSON.scripts['lint:ci']).not.toContain('local');
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

  it('keeps published TypeScript README focused on consumers, not repository internals', () => {
    const readme = rootText('ts/README.md');

    expect(readme).not.toMatch(/workspace copy|monorepo has an extra local package build step/u);
  });

  it('opens a CI-running PR after publishing the TypeScript package', () => {
    const releaseWorkflow = rootText('.github/workflows/release.yml');

    expect(releaseWorkflow).toContain('verify-published-npm-consumption:');
    expect(releaseWorkflow).toContain('- publish-npm');
    expect(releaseWorkflow).toContain(
      "needs.prepare.outputs.ts_released == 'true' && needs.publish-npm.result == 'success'",
    );
    expect(releaseWorkflow).toContain('pull-requests: write');
    expect(releaseWorkflow).toContain('PUBLISHED_CONFIG_PR_TOKEN');
    expect(releaseWorkflow).toContain('codex/verify-published-oxlint-config');
    expect(releaseWorkflow).toContain('ci(ts): verify published oxlint config');
    expect(releaseWorkflow).toContain('https://x-access-token:$GH_TOKEN@github.com');
    expect(releaseWorkflow).toContain('gh pr create');
    expect(releaseWorkflow).not.toContain('ci(ts): verify published oxlint config [skip ci]');
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
