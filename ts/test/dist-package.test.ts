import { describe, expect, it } from 'vitest';
import { Predicate } from 'effect';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { strictEffectTestPaths } from './rules/effect-rule-test-utils';

const repoRoot = join(import.meta.dirname, '..', '..');
const distPackageTestTimeoutMs = 30_000;

type BuiltConfigFactory = typeof import('../src/index').default;
type BuiltPlugin = typeof import('../src/rules/plugin');
type BuiltRuleNames = typeof import('../src/rules/effect-rule-names');

type CliAstCase = {
  filename: string;
  ruleName: string;
  source: string;
};

const astBackedCLICases: readonly CliAstCase[] = [
  {
    ruleName: 'effect-schema-no-redundant-tag-identifier',
    filename: 'src/domain/redundant-schema-tag-identifier.ts',
    source:
      'import { Schema } from "effect";\nclass NotFound extends Schema.TaggedClass<NotFound>("NotFound")("NotFound", { id: Schema.String }) {}',
  },
  {
    ruleName: 'effect-no-crypto-randomUUID',
    filename: 'src/domain/uuid.ts',
    source: 'const id = crypto.randomUUID();',
  },
  {
    ruleName: 'effect-require-schema-is-over-instanceof',
    filename: 'src/domain/instanceof.ts',
    source: 'const ok = value instanceof UserSchema;',
  },
  {
    ruleName: 'effect-prefer-schema-tagged-struct',
    filename: 'src/domain/tagged-struct.ts',
    source: 'const User = Schema.Struct({ _tag: Schema.Literal("User") });',
  },
  {
    ruleName: 'effect-prefer-single-schema-literal-union',
    filename: 'src/domain/literal-union.ts',
    source: 'const Status = Schema.Union(Schema.Literal("A"), Schema.Literal("B"));',
  },
  {
    ruleName: 'effect-require-deterministic-service-keys',
    filename: 'src/domain/service-key.ts',
    source:
      'import { Effect } from "effect";\nclass UserRepo extends Effect.Service<UserRepo>()("Repo", {}) {}',
  },
  {
    ruleName: 'effect-no-node-builtins-when-effect-platform-exists',
    filename: 'src/domain/node-builtins.ts',
    source: 'import { readFileSync } from "node:fs";\nconst text = readFileSync(path);',
  },
  {
    ruleName: 'effect-no-global-fetch',
    filename: 'src/domain/global-fetch.ts',
    source:
      'import { Effect } from "effect";\nconst response = Effect.tryPromise({ try: () => fetch("/users"), catch: (error) => error });',
  },
  {
    ruleName: 'effect-require-suspend-for-recursion',
    filename: 'src/domain/eager-recursion.ts',
    source:
      'import { Effect as Fx } from "effect";\nconst loop = (value: number): Fx.Effect<number> => { Fx.succeed(undefined); return loop(value - 1); };',
  },
  {
    ruleName: 'effect-prefer-effect-void',
    filename: 'src/domain/effect-void.ts',
    source: 'import { Effect } from "effect";\nconst done = Effect.succeed(void 0);',
  },
];

const importFresh = <T extends { default: BuiltConfigFactory } | BuiltPlugin | BuiltRuleNames>(
  path: string,
): Promise<T> => import(`${pathToFileURL(path).href}?t=${Date.now()}`) as Promise<T>;

const runOxlintJSON = (args: string[], cwd: string): string => {
  try {
    return execFileSync('pnpm', ['exec', 'oxlint', ...args], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return Predicate.hasProperty(error, 'stdout') && Predicate.isString(error.stdout)
      ? error.stdout
      : '';
  }
};

describe('published TypeScript package shape', (): void => {
  it.each(['oxlint.config.mjs', 'oxlint.workspace.config.mjs'])(
    'lints source and fixtures but excludes tests, scripts, and benchmarks in %s',
    (config) => {
      const directory = mkdtempSync(join(repoRoot, 'lint-scope-'));
      try {
        for (const [relative, included] of [
          ['src/example.ts', true],
          ['src/fixtures/example.ts', true],
          ['src/example.test.ts', false],
          ['test/example.ts', false],
          ['tests/example.ts', false],
          ['scripts/example.ts', false],
          ['bench/example.ts', false],
          ['benchmarks/example.ts', false],
        ] as const) {
          const filename = join(directory, relative);
          mkdirSync(join(filename, '..'), { recursive: true });
          writeFileSync(filename, '// forbidden source comment\nexport const value = 1;\n');
          const result = spawnSync(
            join(repoRoot, 'node_modules/.bin/oxlint'),
            ['-c', config, '--format', 'json', '--no-error-on-unmatched-pattern', filename],
            { cwd: repoRoot, encoding: 'utf8' },
          );
          expect(result.error).toBeUndefined();
          expect(result.status, `${config}: ${relative}\n${result.stdout}\n${result.stderr}`).toBe(
            included ? 1 : 0,
          );
          expect(result.stdout.includes('no-comments'), relative).toBe(included);
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it(
    'enforces module-mocking policy on repository source',
    () => {
      execFileSync('pnpm', ['--dir', 'ts', 'build'], { cwd: repoRoot, stdio: 'pipe' });
      const directory = mkdtempSync(join(repoRoot, 'lint-regression-'));
      try {
        const filename = join(directory, 'mocking.mts');
        writeFileSync(filename, "import { vi } from 'vitest';\nvi.mock('./dependency');\n");
        const result = spawnSync(
          join(repoRoot, 'node_modules/.bin/oxlint'),
          ['-c', 'oxlint.workspace.config.mjs', '--format', 'json', filename],
          { cwd: repoRoot, encoding: 'utf8' },
        );
        expect(result.error).toBeUndefined();
        expect(result.stdout).toContain('no-module-mocking');
        expect(result.status).toBe(1);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    distPackageTestTimeoutMs,
  );

  it(
    'cleans stale renamed build artifacts before packing dist',
    (): void => {
      const stalePath = join(repoRoot, 'ts', 'dist', 'rules', 'effect-agentic.js');
      mkdirSync(join(repoRoot, 'ts', 'dist', 'rules'), { recursive: true });
      writeFileSync(stalePath, 'export default {};\n');

      execFileSync('pnpm', ['--dir', 'ts', 'build'], {
        cwd: repoRoot,
        stdio: 'pipe',
      });

      expect(existsSync(stalePath)).toBe(false);
    },
    distPackageTestTimeoutMs,
  );

  it(
    'publishes strict Effect rule names as a literal union',
    (): void => {
      execFileSync('pnpm', ['--dir', 'ts', 'build'], {
        cwd: repoRoot,
        stdio: 'pipe',
      });

      const declarations = readFileSync(
        join(repoRoot, 'ts', 'dist', 'rules', 'effect-rule-names.d.ts'),
        'utf8',
      );
      const publicDeclarations = readFileSync(join(repoRoot, 'ts', 'dist', 'index.d.ts'), 'utf8');

      expect(declarations).toContain(
        'effectStrictRuleNames: readonly ["effect-no-run-outside-entrypoints"',
      );
      expect(declarations).not.toContain('effectStrictRuleNames: [string, ...string[]]');
      expect(publicDeclarations).toContain('export type { EffectStrictRuleName }');
    },
    distPackageTestTimeoutMs,
  );

  it(
    'builds an importable dist config with the package-local plugin and all Effect rules',
    async (): Promise<void> => {
      execFileSync('pnpm', ['--dir', 'ts', 'build'], {
        cwd: repoRoot,
        stdio: 'pipe',
      });

      const { default: theThracianOxlint } = await importFresh<{ default: BuiltConfigFactory }>(
        join(repoRoot, 'ts', 'dist', 'index.js'),
      );
      const { effectDefaultRuleNames, effectStrictRuleNames } = await importFresh<BuiltRuleNames>(
        join(repoRoot, 'ts', 'dist', 'rules', 'effect-rule-names.js'),
      );
      const config = theThracianOxlint({
        effect: { strict: { ...strictEffectTestPaths, rules: effectStrictRuleNames } },
      });
      const pluginPath = config.jsPlugins
        ?.filter(Predicate.isString)
        .find((path) => path.endsWith('/dist/rules/plugin.js'));

      expect(pluginPath).toBeDefined();
      expect(existsSync(pluginPath ?? '')).toBe(true);

      const plugin = await importFresh<BuiltPlugin>(pluginPath ?? '');
      for (const ruleName of [...effectDefaultRuleNames, ...effectStrictRuleNames]) {
        expect(plugin.default.rules, `${ruleName} must be registered in dist`).toHaveProperty(
          ruleName,
        );
      }
    },
    distPackageTestTimeoutMs,
  );
});

describe('published TypeScript package CLI rules', (): void => {
  it(
    'executes built custom Effect rules through the real Oxlint CLI',
    async (): Promise<void> => {
      execFileSync('pnpm', ['--dir', 'ts', 'build'], {
        cwd: repoRoot,
        stdio: 'pipe',
      });

      const root = mkdtempSync(join(tmpdir(), 'thx-oxlint-dist-'));

      try {
        const { default: theThracianOxlint } = await importFresh<{ default: BuiltConfigFactory }>(
          join(repoRoot, 'ts', 'dist', 'index.js'),
        );
        const config = theThracianOxlint({
          effect: { strict: { rules: ['effect-require-span-external'] } },
        });
        const rules = {
          'thethracian/effect-require-span-external':
            config.rules?.['thethracian/effect-require-span-external'],
        };
        const configPath = join(root, '.oxlintrc.json');
        const sourcePath = join(root, 'invalid.ts');

        expect(rules['thethracian/effect-require-span-external']).toBe('error');

        writeFileSync(
          configPath,
          JSON.stringify({ jsPlugins: config.jsPlugins, rules }, undefined, 2),
        );
        writeFileSync(sourcePath, 'HttpClient.get(url).pipe(Effect.timeout("1 second"));\n');

        const output = runOxlintJSON(
          [sourcePath, '--config', configPath, '--disable-nested-config', '--format', 'json'],
          repoRoot,
        );

        expect(output).toContain('effect-require-span-external');
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    distPackageTestTimeoutMs,
  );

  it(
    'executes every AST-backed Effect rule through the real Oxlint CLI',
    async (): Promise<void> => {
      execFileSync('pnpm', ['--dir', 'ts', 'build'], {
        cwd: repoRoot,
        stdio: 'pipe',
      });

      const root = mkdtempSync(join(tmpdir(), 'thx-oxlint-ast-rules-'));

      try {
        const { default: theThracianOxlint } = await importFresh<{ default: BuiltConfigFactory }>(
          join(repoRoot, 'ts', 'dist', 'index.js'),
        );
        const { effectDefaultRuleNames, effectStrictRuleNames } = await importFresh<BuiltRuleNames>(
          join(repoRoot, 'ts', 'dist', 'rules', 'effect-rule-names.js'),
        );
        const selectedConfig = theThracianOxlint({
          effect: { strict: { ...strictEffectTestPaths, rules: effectStrictRuleNames } },
        });

        const config = {
          ...selectedConfig,
          rules: {
            ...selectedConfig.rules,
            ...Object.fromEntries(
              effectDefaultRuleNames.map((ruleName) => [`thethracian/${ruleName}`, 'error']),
            ),
          },
        };
        const rules = Object.fromEntries(
          astBackedCLICases.map(({ ruleName }) => [
            `thethracian/${ruleName}`,
            config.rules?.[`thethracian/${ruleName}`],
          ]),
        );
        const configPath = join(root, '.oxlintrc.json');
        const sourcePaths: string[] = [];

        writeFileSync(
          configPath,
          JSON.stringify({ jsPlugins: config.jsPlugins, rules }, undefined, 2),
        );

        for (const testCase of astBackedCLICases) {
          const sourcePath = join(root, testCase.filename);
          mkdirSync(join(sourcePath, '..'), { recursive: true });
          writeFileSync(sourcePath, testCase.source);
          sourcePaths.push(sourcePath);
        }

        const output = runOxlintJSON(
          [...sourcePaths, '--config', configPath, '--disable-nested-config', '--format', 'json'],
          repoRoot,
        );

        for (const { ruleName } of astBackedCLICases) {
          expect(output, `${ruleName} should report through real Oxlint`).toContain(ruleName);
        }

        const nonReportPath = join(root, 'src/domain/suspended-aliased-recursion.ts');
        writeFileSync(
          nonReportPath,
          'import * as Fx from "effect/Effect";\nfunction loop() { return Fx.flatMap(step, () => Fx.suspend(() => loop())); }',
        );
        const nonReportOutput = runOxlintJSON(
          [nonReportPath, '--config', configPath, '--disable-nested-config', '--format', 'json'],
          repoRoot,
        );

        expect(nonReportOutput).not.toContain('effect-require-suspend-for-recursion');
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    distPackageTestTimeoutMs,
  );
});

describe('published TypeScript package exports', (): void => {
  it(
    'imports the built package through the public npm exports surface',
    (): void => {
      execFileSync('pnpm', ['--dir', 'ts', 'build'], {
        cwd: repoRoot,
        stdio: 'pipe',
      });

      const root = mkdtempSync(join(tmpdir(), 'thx-oxlint-package-'));
      const scopePath = join(root, 'node_modules', '@thethracian');
      const consumerPath = join(root, 'consumer.mjs');
      const packagePath = join(repoRoot, 'ts', 'package.json');

      try {
        mkdirSync(scopePath, { recursive: true });
        symlinkSync(join(repoRoot, 'ts'), join(scopePath, 'oxlint-config'), 'dir');
        writeFileSync(
          consumerPath,
          `
          import theThracianOxlint from '@thethracian/oxlint-config';
          import { codemodFix } from '@thethracian/oxlint-config/codemod-fix';

          const config = theThracianOxlint({
            effect: {
              strict: {
                adapterLayers: ['platform/**'],
                rules: ['effect-no-global-fetch'],
              },
            },
          });
          const effectRules = Object.keys(config.rules ?? {}).filter((ruleName) =>
            ruleName.startsWith('thethracian/effect-')
          );
          const pluginPath = config.jsPlugins?.find((path) => path.endsWith('/dist/rules/plugin.js'));

          if (!pluginPath) {
            throw new Error('missing package-local plugin path');
          }
          const globalFetchSetting = config.rules?.['thethracian/effect-no-global-fetch'];
          const globalFetchSeverity = Array.isArray(globalFetchSetting)
            ? globalFetchSetting[0]
            : globalFetchSetting;
          if (globalFetchSeverity !== 'error') {
            throw new Error('missing strict Effect rule through package export');
          }
          if (typeof codemodFix !== 'function') {
            throw new Error('missing codemod-fix package export');
          }

          console.log(JSON.stringify({ effectRuleCount: effectRules.length, pluginPath }));
        `,
        );

        const output = execFileSync('node', [consumerPath], {
          cwd: root,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        const parsed = JSON.parse(output) as { effectRuleCount: number; pluginPath: string };

        expect(parsed.effectRuleCount).toBe(19);
        expect(existsSync(parsed.pluginPath)).toBe(true);

        const packageJSON = JSON.parse(readFileSync(packagePath, 'utf8')) as {
          bin?: { 'thx-codemod-fix'?: string };
        };
        expect(packageJSON.bin?.['thx-codemod-fix']).toBe('./dist/codemod-fix/cli.js');
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    distPackageTestTimeoutMs,
  );
});

describe('full preset rule compatibility', (): void => {
  it.each([
    {
      name: 'generic consumers without erased object or unknown parameters',
      errors: [],
      source: `
        export function keys<T extends object>(value: T): string[] { return Object.keys(value); }
        export function count<T extends Record<string, unknown>>(value: T): number { return Object.keys(value).length; }
        export function ignore<T>(value: T): void { void value; }
      `,
    },
    {
      name: 'primitive type guards without instanceof or unchecked assertions',
      errors: [],
      source: `
        export function isString(value: unknown): value is string { return typeof value === 'string'; }
        export function assertString(value: unknown): asserts value is string {
          if (typeof value !== 'string') throw new TypeError('expected string');
        }
      `,
    },
    {
      name: 'local guards narrowing known unions without losing evidence',
      errors: [],
      source: `
        function isString(value: unknown): value is string { return typeof value === 'string'; }
        export function length(value: string | number): number { return isString(value) ? value.length : value; }
      `,
    },
    {
      name: 'Effect resource scoping, generator delegation, and error causes together',
      errors: [],
      source: `
        import { Effect } from 'effect';
        class LoadError extends Error {
          readonly _tag = 'LoadError';
          constructor(cause: unknown) { super('load failed', { cause }); }
        }
        export const resource = Effect.scoped(Effect.gen(function* () {
          return yield* Effect.acquireRelease(Effect.succeed('resource'), () => Effect.void);
        }));
        export const load = Effect.tryPromise({
          try: () => Promise.resolve('loaded'),
          catch: (cause) => new LoadError(cause),
        });
      `,
    },
    {
      name: 'boundary and dictionary bans remain active',
      errors: [
        'no-object-parameters',
        'no-unknown-parameters',
        'no-unsafe-dictionary-type',
        'no-unknown-returns',
      ],
      source: `
        export function keys(value: object): string[] { return Object.keys(value); }
        export function ignore(value: unknown): void { void value; }
        export function count(value: Record<string, unknown>): number { return Object.keys(value).length; }
        export declare function read(): unknown;
      `,
    },
    {
      name: 'ad hoc typeof and boxed instanceof remain forbidden',
      errors: ['no-runtime-typeof', 'no-instanceof-builtins'],
      source: `
        export function check(value: string | number): boolean { return typeof value === 'string'; }
        export function boxed(value: unknown): value is string { return value instanceof String; }
      `,
    },
    {
      name: 'actual widening and unchecked assertions remain forbidden',
      errors: ['no-known-value-widening', 'no-widen-then-assert', 'no-comments'],
      source: `
        // forbidden comment
        const value: unknown = { id: 'known' };
        export const item = value as { id: string };
      `,
    },
  ])(
    'checks $name',
    async ({ source, errors }): Promise<void> => {
      execFileSync('pnpm', ['--dir', 'ts', 'build'], { cwd: repoRoot, stdio: 'pipe' });
      const root = mkdtempSync(join(tmpdir(), 'thx-rule-compatibility-'));
      try {
        const { default: factory } = await importFresh<{ default: BuiltConfigFactory }>(
          join(repoRoot, 'ts/dist/index.js'),
        );
        const configPath = join(root, '.oxlintrc.json');
        symlinkSync(join(repoRoot, 'ts/node_modules'), join(root, 'node_modules'), 'dir');
        writeFileSync(configPath, JSON.stringify(factory({ typeAware: true, effect: true })));
        writeFileSync(
          join(root, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: {
              strict: true,
              target: 'ES2023',
              module: 'ESNext',
              moduleResolution: 'Bundler',
              noEmit: true,
              types: [],
              skipLibCheck: true,
            },
            include: ['*.ts'],
          }),
        );
        writeFileSync(join(root, 'valid.ts'), source);
        const result = spawnSync(
          join(repoRoot, 'node_modules/.bin/oxlint'),
          ['-c', configPath, '--disable-nested-config', '--format', 'json', join(root, 'valid.ts')],
          { cwd: root, encoding: 'utf8' },
        );
        expect(result.error).toBeUndefined();
        expect(result.status, result.stdout + result.stderr).toBe(errors.length === 0 ? 0 : 1);
        for (const ruleName of errors) {
          expect(result.stdout).toContain(`(${ruleName})`);
        }
        if (errors.length === 0) {
          const fixed = spawnSync(
            join(repoRoot, 'node_modules/.bin/oxlint'),
            ['-c', configPath, '--disable-nested-config', '--fix', join(root, 'valid.ts')],
            { cwd: root, encoding: 'utf8' },
          );
          expect(fixed.error).toBeUndefined();
          expect(fixed.status, fixed.stdout + fixed.stderr).toBe(0);
          expect(readFileSync(join(root, 'valid.ts'), 'utf8')).toBe(source);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    distPackageTestTimeoutMs,
  );
});
