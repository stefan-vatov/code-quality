#!/usr/bin/env node
import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

type Language = 'rust' | 'elixir';

type CliOptions = {
  cwd: string;
  write: boolean;
};

type PatchOperation =
  | {
      kind: 'copy';
      source: string;
      target: string;
    }
  | {
      kind: 'managed-block';
      target: string;
      blockName: string;
      body: string;
    };

const require = createRequire(import.meta.url);

async function main() {
  const { command, language, options } = parseArgs(process.argv.slice(2));

  if (command === 'help') {
    printHelp();
    return;
  }

  if (command === 'doctor') {
    await doctor(options.cwd);
    return;
  }

  if (!language) {
    fail(`Missing language. Expected one of: rust, elixir.`);
  }

  const operations = await operationsFor(language, options.cwd);
  await applyOperations(operations, options);
}

function parseArgs(args: string[]) {
  const command = args[0] ?? 'help';
  const language =
    command === 'doctor' || command === 'help' ? undefined : (args[1] as Language | undefined);
  let cwd = process.cwd();
  let write = false;
  const optionStartIndex = command === 'doctor' || command === 'help' ? 1 : 2;

  for (let index = optionStartIndex; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--write') {
      write = true;
      continue;
    }
    if (arg === '--cwd') {
      const value = args[index + 1];
      if (!value) {
        fail('Expected a path after --cwd.');
      }
      cwd = resolve(value);
      index += 1;
      continue;
    }
    fail(`Unknown option: ${arg}`);
  }

  if (!['help', 'doctor', 'init', 'update'].includes(command)) {
    fail(`Unknown command: ${command}`);
  }

  if (language && !['rust', 'elixir'].includes(language)) {
    fail(`Unsupported language: ${language}`);
  }

  return {
    command,
    language,
    options: { cwd, write },
  };
}

async function operationsFor(language: Language, cwd: string): Promise<PatchOperation[]> {
  if (language === 'rust') {
    return rustOperations(cwd);
  }

  return elixirOperations(cwd);
}

async function rustOperations(cwd: string): Promise<PatchOperation[]> {
  const packageRoot = packageRootFor('@thethracian/rust-lint-config');
  const cargoToml = join(cwd, 'Cargo.toml');
  const isWorkspace = await fileIncludes(cargoToml, '[workspace]');
  const cargoLintsFile = isWorkspace ? 'cargo-lints-workspace.toml' : 'cargo-lints-package.toml';

  return [
    {
      kind: 'copy',
      source: join(packageRoot, 'configs', 'rustfmt.toml'),
      target: join(cwd, 'rustfmt.toml'),
    },
    {
      kind: 'copy',
      source: join(packageRoot, 'configs', 'clippy.toml'),
      target: join(cwd, 'clippy.toml'),
    },
    {
      kind: 'managed-block',
      target: cargoToml,
      blockName: '@thethracian/rust-lint-config',
      body: await readFile(join(packageRoot, 'configs', cargoLintsFile), 'utf8'),
    },
  ];
}

function elixirOperations(cwd: string): PatchOperation[] {
  const packageRoot = packageRootFor('@thethracian/elixir-lint-config');

  return [
    {
      kind: 'copy',
      source: join(packageRoot, 'configs', 'credo.exs'),
      target: join(cwd, '.credo.exs'),
    },
    {
      kind: 'copy',
      source: join(packageRoot, 'configs', 'dialyzer_ignore.exs'),
      target: join(cwd, '.dialyzer_ignore.exs'),
    },
  ];
}

async function applyOperations(operations: PatchOperation[], options: CliOptions) {
  const planned = [];

  for (const operation of operations) {
    if (operation.kind === 'copy') {
      planned.push(`copy ${operation.source} -> ${operation.target}`);
      if (options.write) {
        await mkdir(dirname(operation.target), { recursive: true });
        await copyFile(operation.source, operation.target);
      }
      continue;
    }

    planned.push(`patch ${operation.target} with ${operation.blockName}`);
    if (options.write) {
      await upsertManagedBlock(operation.target, operation.blockName, operation.body);
    }
  }

  const mode = options.write ? 'Applied' : 'Preview';
  console.log(`${mode} ${planned.length} operation(s):`);
  for (const line of planned) {
    console.log(`- ${line}`);
  }

  if (!options.write) {
    console.log('\nRun again with --write to apply changes.');
  }
}

async function upsertManagedBlock(target: string, blockName: string, body: string) {
  if (!(await exists(target))) {
    console.warn(`Skipping ${target}; file does not exist.`);
    return;
  }

  const begin = `# BEGIN ${blockName}`;
  const end = `# END ${blockName}`;
  const block = `${begin}\n${body.trim()}\n${end}`;
  const current = await readFile(target, 'utf8');
  const pattern = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`);
  const next = pattern.test(current)
    ? current.replace(pattern, block)
    : `${current.trimEnd()}\n\n${block}\n`;

  await writeFile(target, next);
}

async function doctor(cwd: string) {
  const checks = [
    ['Cargo.toml', join(cwd, 'Cargo.toml')],
    ['mix.exs', join(cwd, 'mix.exs')],
    ['rustfmt.toml', join(cwd, 'rustfmt.toml')],
    ['clippy.toml', join(cwd, 'clippy.toml')],
    ['.credo.exs', join(cwd, '.credo.exs')],
    ['.dialyzer_ignore.exs', join(cwd, '.dialyzer_ignore.exs')],
  ] as const;

  for (const [label, file] of checks) {
    console.log(`${(await exists(file)) ? 'ok' : 'missing'} ${label}`);
  }
}

function packageRootFor(packageName: string) {
  return dirname(require.resolve(`${packageName}/package.json`));
}

async function fileIncludes(file: string, content: string) {
  if (!(await exists(file))) {
    return false;
  }
  return (await readFile(file, 'utf8')).includes(content);
}

async function exists(file: string) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function printHelp() {
  console.log(`thx-lint-cli

Usage:
  thx-lint-cli init rust [--write] [--cwd <path>]
  thx-lint-cli init elixir [--write] [--cwd <path>]
  thx-lint-cli update rust [--write] [--cwd <path>]
  thx-lint-cli update elixir [--write] [--cwd <path>]
  thx-lint-cli doctor [--cwd <path>]
`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
