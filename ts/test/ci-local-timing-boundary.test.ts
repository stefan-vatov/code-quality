import { describe, expect, it } from 'vitest';
import { join, relative } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const testRoot = join(repositoryRoot, 'ts', 'test');
const policyTestPath = fileURLToPath(import.meta.url);
const localOnlyTimingSuffix = '.local-timing.test.ts';
const localOnlyTimingGlob = `**/*${localOnlyTimingSuffix}`;
const wallClockPattern =
  /\b(?:performance\s*\.\s*now|process\s*\.\s*(?:cpuUsage|hrtime(?:\s*\.\s*bigint)?))\s*\(/u;
const processTimingImportPattern = /from\s+['"]node:process['"]/u;
const directProcessTimingCallPattern = /\b(?:cpuUsage|hrtime(?:\s*\.\s*bigint)?)\s*\(/u;
const childProcessImportPattern = /from\s+['"]node:child_process['"]/u;
const childProcessTimeoutPattern = /\btimeout\s*:/u;

const collectTestFiles = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry): readonly string[] => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectTestFiles(entryPath);
    }
    if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      return [entryPath];
    }
    return [];
  });

const isTimingTest = (source: string): boolean =>
  wallClockPattern.test(source) ||
  (processTimingImportPattern.test(source) && directProcessTimingCallPattern.test(source)) ||
  (childProcessImportPattern.test(source) && childProcessTimeoutPattern.test(source));

const timingTestPaths = (): readonly string[] =>
  collectTestFiles(testRoot).filter(
    (testPath): boolean =>
      testPath !== policyTestPath && isTimingTest(readFileSync(testPath, 'utf8')),
  );

const relativeTestPath = (testPath: string): string => relative(repositoryRoot, testPath);

const parseExclusions = (output: string): readonly string[] => {
  const value: unknown = JSON.parse(output);
  if (!Array.isArray(value)) {
    throw new Error('Vitest config probe did not return an exclusion array.');
  }
  if (value.some((entry): boolean => typeof entry !== 'string')) {
    throw new Error('Vitest config probe returned a non-string exclusion.');
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
};

const vitestExclusions = (isCI: boolean): readonly string[] => {
  const environment = { ...process.env };
  if (isCI) {
    environment.CI = 'true';
  } else {
    delete environment.CI;
  }

  const output = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      "import config from './vitest.config.mts'; process.stdout.write(JSON.stringify(config.test?.exclude ?? []));",
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return parseExclusions(output);
};

describe('Vitest local-only timing boundary', (): void => {
  it('recognizes direct node:process CPU timing imports', (): void => {
    const source = "import { cpuUsage } from 'node:process'; cpuUsage();";

    expect(isTimingTest(source)).toBe(true);
  });

  it('classifies every wall-clock or child-timeout test as local-only', (): void => {
    const timingPaths = timingTestPaths();
    const unclassifiedPaths = timingPaths.filter(
      (testPath): boolean => !testPath.endsWith(localOnlyTimingSuffix),
    );

    expect(timingPaths).not.toHaveLength(0);
    expect(
      unclassifiedPaths.map(relativeTestPath),
      'Timing-sensitive tests must use the .local-timing.test.ts classification suffix.',
    ).toStrictEqual([]);
  });

  it('excludes local-only timing tests in CI while retaining them locally', (): void => {
    const ciExclusions = vitestExclusions(true);
    const localExclusions = vitestExclusions(false);

    expect(ciExclusions).toContain(localOnlyTimingGlob);
    expect(localExclusions).not.toContain(localOnlyTimingGlob);
  });
});
