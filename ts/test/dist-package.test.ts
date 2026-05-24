import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..', '..');
const distPackageTestTimeoutMs = 30_000;

type BuiltConfigFactory = (options?: { effect?: { strict?: boolean } }) => {
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

const astBackedCliCases: CliAstCase[] = [
  {
    ruleName: 'effect-no-promise-then-in-effect',
    filename: 'src/domain/promise-then.ts',
    source: 'import { Effect } from "effect";\nfetch("/").then((response) => response.text());',
  },
  {
    ruleName: 'effect-no-string-errors',
    filename: 'src/domain/string-error.ts',
    source: 'import { Effect } from "effect";\nconst failure = Effect.fail(`bad`);',
  },
  {
    ruleName: 'effect-no-untagged-errors',
    filename: 'src/domain/untagged-error.ts',
    source: 'import { Effect } from "effect";\nconst failure = Effect.fail(new Error("bad"));',
  },
  {
    ruleName: 'effect-no-console-log-in-effect-code',
    filename: 'src/domain/console.ts',
    source: 'import { Effect } from "effect";\nconsole.log(Effect.succeed(1));',
  },
  {
    ruleName: 'effect-no-process-env-in-effect-code',
    filename: 'src/domain/env.ts',
    source: 'import { Effect } from "effect";\nconst token = process.env.API_TOKEN;',
  },
  {
    ruleName: 'effect-no-date-now-in-effect-code',
    filename: 'src/domain/date.ts',
    source: 'import { Effect } from "effect";\nconst now = Date.now();',
  },
  {
    ruleName: 'effect-no-math-random-in-effect-code',
    filename: 'src/domain/random.ts',
    source: 'import { Effect } from "effect";\nconst value = Math.random();',
  },
  {
    ruleName: 'effect-no-try-catch-in-effect-gen',
    filename: 'src/domain/try-catch.ts',
    source:
      'import { Effect as E } from "effect";\nconst program = E.gen(function* () { try { return yield* load; } catch (error) { return yield* E.fail(error); } });',
  },
  {
    ruleName: 'effect-no-new-promise',
    filename: 'src/domain/new-promise.ts',
    source: 'import { Effect } from "effect";\nconst task = new Promise((resolve) => resolve(1));',
  },
  {
    ruleName: 'effect-no-global-timers',
    filename: 'src/domain/timer.ts',
    source: 'import { Effect } from "effect";\nsetTimeout(() => Effect.runFork(task), 10);',
  },
  {
    ruleName: 'effect-no-native-error-classes',
    filename: 'src/domain/native-error.ts',
    source: 'import { Effect } from "effect";\nclass NotFound extends Error {}',
  },
  {
    ruleName: 'effect-no-unsafe-effect-type-assertion',
    filename: 'src/domain/assertion.ts',
    source: 'const program = value as Effect.Effect<string, never, never>;',
  },
  {
    ruleName: 'effect-require-service-self-match',
    filename: 'src/domain/service-self.ts',
    source:
      'import { Effect } from "effect";\nclass UserRepo extends Effect.Service<OrderRepo>()("UserRepo", {}) {}',
  },
  {
    ruleName: 'effect-no-effect-fn-iife',
    filename: 'src/domain/fn-iife.ts',
    source:
      'import { Effect } from "effect";\nconst value = Effect.fn("load")(function* () { return yield* task; })();',
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
    ruleName: 'effect-prefer-effect-void',
    filename: 'src/domain/effect-void.ts',
    source: 'import { Effect } from "effect";\nconst done = Effect.succeed(void 0);',
  },
];

function importFresh<T>(path: string): Promise<T> {
  return import(`${pathToFileURL(path).href}?t=${Date.now()}`) as Promise<T>;
}

function runOxlintJson(args: string[], cwd: string): string {
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
}

describe('published TypeScript package shape', () => {
  it(
    'cleans stale renamed build artifacts before packing dist',
    () => {
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
    'builds an importable dist config with the package-local plugin and all Effect rules',
    async () => {
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
      const config = theThracianOxlint({ effect: { strict: true } });
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
    async () => {
      execFileSync('pnpm', ['--dir', 'ts', 'build'], {
        cwd: repoRoot,
        stdio: 'pipe',
      });

      const root = mkdtempSync(join(tmpdir(), 'thx-oxlint-dist-'));

      try {
        const { default: theThracianOxlint } = await importFresh<{ default: BuiltConfigFactory }>(
          join(repoRoot, 'ts', 'dist', 'index.js'),
        );
        const config = theThracianOxlint({ effect: { strict: true } });
        const rules = {
          'thethracian/effect-no-string-errors':
            config.rules?.['thethracian/effect-no-string-errors'],
          'thethracian/effect-require-span-external':
            config.rules?.['thethracian/effect-require-span-external'],
        };
        const configPath = join(root, '.oxlintrc.json');
        const sourcePath = join(root, 'invalid.ts');

        expect(rules['thethracian/effect-no-string-errors']).toBe('error');
        expect(rules['thethracian/effect-require-span-external']).toBe('error');

        writeFileSync(
          configPath,
          JSON.stringify({ jsPlugins: config.jsPlugins, rules }, undefined, 2),
        );
        writeFileSync(
          sourcePath,
          'const failure = Effect.fail("bad");\nHttpClient.get(url).pipe(Effect.timeout("1 second"));\n',
        );

        const output = runOxlintJson(
          [sourcePath, '--config', configPath, '--disable-nested-config', '--format', 'json'],
          repoRoot,
        );

        expect(output).toContain('effect-no-string-errors');
        expect(output).toContain('effect-require-span-external');
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    distPackageTestTimeoutMs,
  );

  it(
    'executes every AST-backed Effect rule through the real Oxlint CLI',
    async () => {
      execFileSync('pnpm', ['--dir', 'ts', 'build'], {
        cwd: repoRoot,
        stdio: 'pipe',
      });

      const root = mkdtempSync(join(tmpdir(), 'thx-oxlint-ast-rules-'));

      try {
        const { default: theThracianOxlint } = await importFresh<{ default: BuiltConfigFactory }>(
          join(repoRoot, 'ts', 'dist', 'index.js'),
        );
        const config = theThracianOxlint({ effect: { strict: true } });
        const rules = Object.fromEntries(
          astBackedCliCases.map(({ ruleName }) => [
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

        for (const testCase of astBackedCliCases) {
          const sourcePath = join(root, testCase.filename);
          mkdirSync(join(sourcePath, '..'), { recursive: true });
          writeFileSync(sourcePath, testCase.source);
          sourcePaths.push(sourcePath);
        }

        const output = runOxlintJson(
          [...sourcePaths, '--config', configPath, '--disable-nested-config', '--format', 'json'],
          repoRoot,
        );

        for (const { ruleName } of astBackedCliCases) {
          expect(output, `${ruleName} should report through real Oxlint`).toContain(ruleName);
        }
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    distPackageTestTimeoutMs,
  );

  it(
    'imports the built package through the public npm exports surface',
    () => {
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

          const config = theThracianOxlint({ effect: { strict: true } });
          const effectRules = Object.keys(config.rules ?? {}).filter((ruleName) =>
            ruleName.startsWith('thethracian/effect-')
          );
          const pluginPath = config.jsPlugins?.find((path) => path.endsWith('/dist/rules/plugin.js'));

          if (!pluginPath) {
            throw new Error('missing package-local plugin path');
          }
          if (config.rules?.['thethracian/effect-no-global-fetch'] !== 'error') {
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

        expect(parsed.effectRuleCount).toBe(141);
        expect(existsSync(parsed.pluginPath)).toBe(true);
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
          bin?: Record<string, string>;
        };
        expect(packageJson.bin?.['thx-codemod-fix']).toBe('./dist/codemod-fix/cli.js');
      } finally {
        rmSync(root, { force: true, recursive: true });
      }
    },
    distPackageTestTimeoutMs,
  );
});
