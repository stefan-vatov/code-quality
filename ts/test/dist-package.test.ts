import { describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { strictEffectTestPaths } from './rules/effect-rule-test-utils';

const repoRoot = join(import.meta.dirname, '..', '..');
const distPackageTestTimeoutMs = 30_000;

type BuiltConfigFactory = (options?: {
  effect?:
    | boolean
    | {
        enabled?: boolean;
        strict?: { rules: readonly string[]; [key: string]: unknown };
      };
}) => {
  jsPlugins?: string[];
  rules?: Record<string, unknown>;
};

type BuiltPlugin = {
  default: {
    rules: Record<string, unknown>;
  };
};

type BuiltRuleNames = {
  effectDefaultRuleNames: readonly string[];
  effectStrictRuleNames: readonly string[];
};

type CliAstCase = {
  filename: string;
  ruleName: string;
  source: string;
};

const astBackedCLICases = [
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

const importFresh = <T>(path: string): Promise<T> =>
  import(`${pathToFileURL(path).href}?t=${Date.now()}`) as Promise<T>;

const runOxlintJSON = (args: string[], cwd: string): string => {
  try {
    return execFileSync('pnpm', ['exec', 'oxlint', ...args], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const output = (error as { stdout?: string }).stdout;
    return output ?? '';
  }
};

describe('published TypeScript package shape', (): void => {
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
      const pluginPath = config.jsPlugins?.find((path) => path.endsWith('/dist/rules/plugin.js'));

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
        // This CLI fixture intentionally exercises every registered rule. The
        // published preset only enables the safety bucket; the rest are added
        // here explicitly so coverage does not imply a noisy default policy.
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
          bin?: Record<string, string>;
        };
        expect(packageJSON.bin?.['thx-codemod-fix']).toBe('./dist/codemod-fix/cli.js');
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    distPackageTestTimeoutMs,
  );
});
