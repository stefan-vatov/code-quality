import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(repositoryRoot, 'scripts', 'corpus-gate.json');
const baselinePath = join(repositoryRoot, 'scripts', 'corpus-baseline.json');
const cacheRoot = join(repositoryRoot, '.cache', 'corpus');
const oxlintBinary = join(repositoryRoot, 'node_modules', '.bin', 'oxlint');
const unnamedRule = '(unnamed)';

const sortedRecord = (record) =>
  Object.fromEntries(
    Object.entries(record).toSorted(([left], [right]) => left.localeCompare(right)),
  );

const ruleIdOf = (code) =>
  code === undefined || code === '' ? unnamedRule : code.replace(/^([^()]+)\((.+)\)$/u, '$1/$2');

const countRuleHits = (diagnostics) => {
  const counts = {};
  for (const { code } of diagnostics) {
    const ruleId = ruleIdOf(code);
    counts[ruleId] = (counts[ruleId] ?? 0) + 1;
  }
  return sortedRecord(counts);
};

const selectCorpusRules = (rules, trackedNativeRules) =>
  Object.fromEntries(
    Object.entries(rules).filter(
      ([ruleName]) => ruleName.startsWith('thethracian/') || trackedNativeRules.includes(ruleName),
    ),
  );

const compareToBaseline = (baseline, current) => {
  const rows = [];
  const repos = [...new Set([...Object.keys(baseline), ...Object.keys(current)])].toSorted();
  for (const repo of repos) {
    const before = baseline[repo] ?? {};
    const after = current[repo] ?? {};
    const rules = [...new Set([...Object.keys(before), ...Object.keys(after)])].toSorted();
    for (const rule of rules) {
      const baselineCount = before[rule] ?? 0;
      const currentCount = after[rule] ?? 0;
      if (baselineCount !== currentCount) {
        rows.push({
          baseline: baselineCount,
          current: currentCount,
          delta: currentCount - baselineCount,
          repo,
          rule,
        });
      }
    }
  }
  return rows;
};

const run = (command, args, options = {}) =>
  spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, ...options });

const ensureRepository = ({ name, sha, url }) => {
  const directory = join(cacheRoot, name);
  const head = run('git', ['-C', directory, 'rev-parse', 'HEAD']);
  if (head.status === 0 && head.stdout.trim() === sha) return { directory, ok: true };
  mkdirSync(directory, { recursive: true });
  const steps = [
    ['init', '--quiet', directory],
    ['-C', directory, 'remote', 'remove', 'origin'],
    ['-C', directory, 'remote', 'add', 'origin', url],
    ['-C', directory, 'fetch', '--quiet', '--depth', '1', 'origin', sha],
    ['-C', directory, 'checkout', '--quiet', '--force', 'FETCH_HEAD'],
  ];
  for (const step of steps) {
    const result = run('git', step);
    const isOptionalRemoval = step.includes('remove');
    if (result.status !== 0 && !isOptionalRemoval) {
      return {
        directory,
        error: `git ${step.join(' ')} failed: ${result.stderr.trim()}`,
        ok: false,
      };
    }
  }
  return { directory, ok: true };
};

const writeCorpusConfig = async (trackedNativeRules) => {
  const factoryUrl = pathToFileURL(join(repositoryRoot, 'ts', 'dist', 'index.js')).href;
  const { default: factory } = await import(factoryUrl);
  const config = factory({ effect: true });
  const configPath = join(cacheRoot, 'oxlint.corpus.json');
  mkdirSync(cacheRoot, { recursive: true });
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        categories: config.categories,
        jsPlugins: config.jsPlugins,
        plugins: config.plugins,
        rules: selectCorpusRules(config.rules ?? {}, trackedNativeRules),
      },
      null,
      2,
    )}\n`,
  );
  return configPath;
};

const lintRepository = (configPath, directory) => {
  const result = run(
    oxlintBinary,
    ['-c', configPath, '--disable-nested-config', '-f', 'json', '.'],
    {
      cwd: directory,
    },
  );
  if (result.stdout.trim() === '') return { error: result.stderr.trim(), ok: false };
  return { counts: countRuleHits(JSON.parse(result.stdout).diagnostics), ok: true };
};

const formatRows = (rows) =>
  rows
    .map(
      ({ baseline, current, delta, repo, rule }) =>
        `${repo.padEnd(16)} ${rule.padEnd(58)} ${String(baseline).padStart(6)} -> ${String(current).padStart(6)} (${delta > 0 ? '+' : ''}${delta})`,
    )
    .join('\n');

const runCli = async (argv) => {
  const update = argv.includes('--update');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const configPath = await writeCorpusConfig(manifest.trackedNativeRules);
  const current = {};
  for (const repository of manifest.repositories) {
    const checkout = ensureRepository(repository);
    if (!checkout.ok) {
      process.stderr.write(`${repository.name}: ${checkout.error}\n`);
      process.exitCode = 1;
      return;
    }
    const linted = lintRepository(configPath, checkout.directory);
    if (!linted.ok) {
      process.stderr.write(`${repository.name}: oxlint produced no report. ${linted.error}\n`);
      process.exitCode = 1;
      return;
    }
    current[repository.name] = linted.counts;
  }
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};
  const rows = compareToBaseline(baseline, current);
  process.stdout.write(
    rows.length === 0
      ? 'Corpus hit counts match the baseline.\n'
      : `Corpus hit counts changed (review each delta; true positives and false positives both move counts):\n${formatRows(rows)}\n`,
  );
  if (update) {
    writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    process.stdout.write(`Updated ${baselinePath}.\n`);
  }
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli(process.argv);
}

export { compareToBaseline, countRuleHits, selectCorpusRules };
