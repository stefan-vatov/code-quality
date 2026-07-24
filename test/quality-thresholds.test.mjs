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
    const dependencyVersion = packageJSON.devDependencies['@thethracian/oxlint-config'];

    expect(dependencyVersion).toMatch(/^(?:npm:@thethracian\/oxlint-config@)?\d+\.\d+\.\d+$/u);
    expect(dependencyVersion).not.toMatch(/^(?:file|link|workspace):/u);
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
    const knipConfig = rootJSON('knip.json');
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
    expect(localConfig).toContain("existsSync(new URL('./ts/dist/index.js', import.meta.url))");
    expect(localConfig).toContain("await import('./ts/dist/index.js')");
    expect(localConfig).toContain("await import('@thethracian/oxlint-config')");
    expect(publishedConfig).toContain("'oxlint.workspace.config.mjs'");
    expect(knipConfig.ignore).toContain('oxlint.workspace.config.mjs');
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

  it('runs native plugin compatibility against the exact minimum Oxlint peer', () => {
    const packageJSON = rootJSON('package.json');
    const ciWorkflow = rootText('.github/workflows/ci.yml');
    const verifier = rootText('ts/test/oxlint-min-peer/verify.mjs');

    expect(packageJSON.scripts['test:oxlint-min-peer']).toBe(
      'pnpm --dir ts build && node ts/test/oxlint-min-peer/verify.mjs',
    );
    expect(packageJSON.scripts['test:oxlint-min-peer']).not.toContain('oxlint@^1.63');
    expect(ciWorkflow).toContain('oxlint-min-peer:');
    expect(ciWorkflow).toContain('name: Oxlint 1.63.0 minimum peer compatibility');
    expect(ciWorkflow).toContain('run: pnpm run test:oxlint-min-peer');
    expect(verifier).toContain("'oxlint@1.63.0'");
    expect(verifier).not.toContain("'oxlint@^1.63'");
    expect(verifier).toContain("'--format'");
    expect(verifier).toContain("'json'");
    expect(verifier).toMatch(
      /assert\.equal\(\s*diagnostics\.length\s*,\s*expectedRuleIDs\.length\s*\)/u,
    );
    expect(verifier).toMatch(
      /assert\.deepStrictEqual\(\s*ruleIDs\.toSorted\(\)\s*,\s*expectedRuleIDs\.toSorted\(\)\s*\)/u,
    );
    expect(verifier).toMatch(/runOxlint\(\s*temporarySafePath\s*,\s*\[\s*'--fix'\s*\]\s*\)/u);
    expect(verifier).toMatch(/assert\.equal\(\s*safeResult\.status\s*,\s*0\s*,/u);
    expect(verifier).toMatch(
      /assert\.equal\(\s*JSON\.parse\(safeResult\.stdout\)\.diagnostics\.length\s*,\s*0\s*\)/u,
    );
    expect(verifier).toMatch(/assert\.equal\(\s*afterFix\s*,\s*beforeFix\s*\)/u);

    const compatibilityConfig = rootText('ts/test/oxlint-min-peer/oxlint.config.mjs');
    const invalidFixture = rootText('ts/test/oxlint-min-peer/invalid.ts');
    const safeFixture = rootText('ts/test/oxlint-min-peer/safe.ts');

    for (const ruleName of [
      'thethracian/no-commented-out-code',
      'thethracian/effect-no-sync-for-promise',
      'thethracian/effect-no-global-fetch',
      'thethracian/effect-prefer-map-over-flatMap-succeed',
    ]) {
      expect(compatibilityConfig).toContain(`'${ruleName}': 'error'`);
    }

    expect(invalidFixture).toContain('// const discarded = Effect.succeed(0);');
    expect(invalidFixture).toContain('Effect.sync(() => Promise.resolve(1))');
    expect(invalidFixture).toContain("try: () => fetch('/users')");
    expect(invalidFixture).toContain(
      'Effect.flatMap(promised, (value) => Effect.succeed(value + 1))',
    );
    expect(safeFixture).toContain('Effect.succeed(1).pipe(Effect.map((value) => value + 1))');
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
      break: 82,
      high: 90,
      low: 82,
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
