import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { EOL } from 'node:os';
import { pathToFileURL } from 'node:url';

const PACKAGE_CONFIGS = [
  {
    changelogPath: 'ts/CHANGELOG.md',
    id: 'ts',
    name: '@thethracian/oxlint-config',
    paths: ['ts'],
    tagPrefix: '@thethracian/oxlint-config',
    versionFiles: ['ts/package.json'],
  },
  {
    changelogPath: 'rust/CHANGELOG.md',
    id: 'rust',
    name: 'cargo-thx-lint',
    paths: ['rust'],
    tagPrefix: 'cargo-thx-lint',
    versionFiles: ['rust/Cargo.toml', 'rust/Cargo.lock'],
  },
  {
    changelogPath: 'elixir/CHANGELOG.md',
    id: 'elixir',
    name: 'the_thracian_credo',
    paths: ['elixir'],
    tagPrefix: 'the_thracian_credo',
    versionFiles: ['elixir/mix.exs'],
  },
];

const bumpRank = {
  none: 0,
  patch: 1,
  minor: 2,
  major: 3,
};

function planPackageRelease({
  commits,
  currentVersion,
  date,
  hasCurrentChangelogEntry = false,
  lastTag,
  name,
  tagPrefix,
}) {
  if (lastTag === null) {
    if (hasCurrentChangelogEntry) {
      return {
        bump: 'pending',
        changelogSections: {},
        date,
        name,
        nextVersion: currentVersion,
        previousVersion: null,
        release: true,
        tag: `${tagPrefix}@${currentVersion}`,
      };
    }

    return {
      bump: 'initial',
      changelogSections: {
        Added: ['Initial release.'],
      },
      date,
      name,
      nextVersion: currentVersion,
      previousVersion: null,
      release: true,
      tag: `${tagPrefix}@${currentVersion}`,
    };
  }

  const previousVersion = versionFromTag(lastTag, tagPrefix);
  if (compareVersions(currentVersion, previousVersion) < 0) {
    throw new Error(`Manifest version ${currentVersion} is older than latest tag ${lastTag}`);
  }

  if (compareVersions(currentVersion, previousVersion) > 0) {
    return {
      bump: 'pending',
      changelogSections: {},
      date,
      name,
      nextVersion: currentVersion,
      previousVersion,
      release: true,
      tag: `${tagPrefix}@${currentVersion}`,
    };
  }

  const classifiedCommits = commits
    .map((commit) => classifyCommit(commit, currentVersion))
    .filter((commit) => commit.bump !== 'none');
  const bump = highestBump(classifiedCommits);

  if (bump === 'none') {
    return {
      bump,
      changelogSections: {},
      date,
      name,
      nextVersion: currentVersion,
      previousVersion,
      release: false,
      tag: null,
    };
  }

  const nextVersion = bumpVersion(currentVersion, bump);

  return {
    bump,
    changelogSections: changelogSections(classifiedCommits),
    date,
    name,
    nextVersion,
    previousVersion,
    release: true,
    tag: `${tagPrefix}@${nextVersion}`,
  };
}

function applyReleasePlan({ files, plans }) {
  const nextFiles = new Map(files);

  for (const plan of plans.filter((candidate) => candidate.release)) {
    if (plan.bump === 'pending') {
      continue;
    }

    if (plan.bump !== 'initial') {
      updateVersionFiles(nextFiles, plan);
    }
    prependChangelog(nextFiles, plan);
  }

  return nextFiles;
}

function classifyCommit(commit, currentVersion) {
  const header = conventionalHeader(commit.subject);
  if (isNonReleasingConventionalCommit(header)) {
    return {
      ...commit,
      bump: 'none',
      section: null,
    };
  }

  if (isBreakingChange(commit)) {
    return {
      ...commit,
      bump: isPreMajor(currentVersion) ? 'minor' : 'major',
      section: 'Breaking Changes',
    };
  }

  const type = header?.type ?? null;
  if (type === 'feat') {
    return {
      ...commit,
      bump: 'minor',
      section: 'Features',
    };
  }

  if (type === 'fix') {
    return {
      ...commit,
      bump: 'patch',
      section: 'Fixes',
    };
  }

  if (type === 'chore' || type === 'perf' || type === 'refactor') {
    return {
      ...commit,
      bump: 'patch',
      section: 'Changes',
    };
  }

  return {
    ...commit,
    bump: 'none',
    section: null,
  };
}

function isBreakingChange(commit) {
  return (
    /^[a-z]+(?:\([^)]+\))?!: /iu.test(commit.subject) ||
    /^BREAKING(?: |-)?CHANGE: /imu.test(commit.body)
  );
}

function conventionalHeader(subject) {
  const match = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?!?: /iu.exec(subject);
  if (match?.groups === undefined) {
    return null;
  }

  return {
    scope: match.groups.scope?.toLowerCase() ?? null,
    type: match.groups.type.toLowerCase(),
  };
}

function isNonReleasingConventionalCommit(header) {
  return (
    header?.type === 'build' ||
    header?.type === 'ci' ||
    header?.type === 'docs' ||
    header?.type === 'test' ||
    (header?.type === 'chore' && header.scope === 'release')
  );
}

function isPreMajor(version) {
  return parseVersion(version).major === 0;
}

function highestBump(commits) {
  return commits.reduce(
    (highest, commit) => (bumpRank[commit.bump] > bumpRank[highest] ? commit.bump : highest),
    'none',
  );
}

function bumpVersion(version, bump) {
  const parsed = parseVersion(version);

  if (bump === 'major') {
    return `${parsed.major + 1}.0.0`;
  }

  if (bump === 'minor') {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }

  if (bump === 'patch') {
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }

  return version;
}

function parseVersion(version) {
  const match = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u.exec(version);

  if (match?.groups === undefined) {
    throw new Error(`Unsupported version: ${version}`);
  }

  return {
    major: Number.parseInt(match.groups.major, 10),
    minor: Number.parseInt(match.groups.minor, 10),
    patch: Number.parseInt(match.groups.patch, 10),
  };
}

function changelogSections(commits) {
  const sections = {};

  for (const section of ['Breaking Changes', 'Features', 'Fixes', 'Changes']) {
    const entries = commits
      .filter((commit) => commit.section === section)
      .map((commit) => `${commit.subject} (${commit.hash.slice(0, 7)})`);

    if (entries.length > 0) {
      sections[section] = entries;
    }
  }

  return sections;
}

function updateVersionFiles(files, plan) {
  if (plan.name === '@thethracian/oxlint-config') {
    const packageJson = JSON.parse(readRequired(files, 'ts/package.json'));
    packageJson.version = plan.nextVersion;
    files.set('ts/package.json', `${JSON.stringify(packageJson, null, 2)}\n`);
  }

  if (plan.name === 'cargo-thx-lint') {
    files.set(
      'rust/Cargo.toml',
      replaceRequired({
        files,
        path: 'rust/Cargo.toml',
        pattern: /(^version\s*=\s*")[^"]+(")/mu,
        replacement: `$1${plan.nextVersion}$2`,
      }),
    );
    files.set(
      'rust/Cargo.lock',
      replaceRequired({
        files,
        path: 'rust/Cargo.lock',
        pattern: /(name\s*=\s*"cargo-thx-lint"\s+version\s*=\s*")[^"]+(")/u,
        replacement: `$1${plan.nextVersion}$2`,
      }),
    );
  }

  if (plan.name === 'the_thracian_credo') {
    files.set(
      'elixir/mix.exs',
      replaceRequired({
        files,
        path: 'elixir/mix.exs',
        pattern: /(version:\s*")[^"]+(")/u,
        replacement: `$1${plan.nextVersion}$2`,
      }),
    );
  }
}

function prependChangelog(files, plan) {
  files.set(
    changelogPath(plan.name),
    prependChangelogEntry(files.get(changelogPath(plan.name)), plan),
  );
}

function prependChangelogEntry(current, plan) {
  const header = '# Changelog';
  const body = [`## ${plan.nextVersion} - ${plan.date}`, ''];

  if (current !== undefined && changelogHasVersion(current, plan.nextVersion)) {
    return `${current.trimEnd()}\n`;
  }

  for (const [section, entries] of Object.entries(plan.changelogSections)) {
    body.push(`### ${section}`, '');
    for (const entry of entries) {
      body.push(`- ${entry}`);
    }
    body.push('');
  }

  if (current === undefined) {
    return `${header}\n\n${body.join('\n').trimEnd()}\n`;
  }

  const trimmed = current.trim();
  if (trimmed === header) {
    return `${header}\n\n${body.join('\n').trimEnd()}\n`;
  }

  return `${header}\n\n${body.join('\n').trimEnd()}\n\n${trimmed.replace(/^# Changelog\s*/u, '')}\n`;
}

function changelogPath(packageName) {
  const config = PACKAGE_CONFIGS.find((candidate) => candidate.name === packageName);

  if (config === undefined) {
    throw new Error(`Unknown package for changelog: ${packageName}`);
  }

  return config.changelogPath;
}

function readRequired(files, path) {
  const content = files.get(path);

  if (content === undefined) {
    throw new Error(`Missing release file: ${path}`);
  }

  return content;
}

function replaceRequired({ files, path, pattern, replacement }) {
  const current = readRequired(files, path);
  const next = current.replace(pattern, replacement);

  if (next === current) {
    throw new Error(`Could not update version in ${path}`);
  }

  return next;
}

function currentDate() {
  return new Date().toISOString().slice(0, 10);
}

function changelogHasVersion(content, version) {
  return new RegExp(`^##\\s+${escapeRegExp(version)}(?:\\s+-|\\s*$)`, 'mu').test(content);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function readPackageVersion(config) {
  const [firstVersionFile] = config.versionFiles;
  const content = readFileSync(firstVersionFile, 'utf8');

  if (firstVersionFile.endsWith('package.json')) {
    return JSON.parse(content).version;
  }

  const match =
    /version\s*=\s*"(?<version>\d+\.\d+\.\d+)"/u.exec(content) ??
    /version:\s*"(?<version>\d+\.\d+\.\d+)"/u.exec(content);

  if (match?.groups === undefined) {
    throw new Error(`Could not read version from ${firstVersionFile}`);
  }

  return match.groups.version;
}

function latestTagFor(config) {
  const tags = execFileSync('git', ['tag', '--list'], {
    encoding: 'utf8',
  })
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .filter((tag) => tag.startsWith(`${config.tagPrefix}@`))
    .map((tag) => ({
      tag,
      version: tag.slice(config.tagPrefix.length + 1),
    }))
    .filter((tag) => /^\d+\.\d+\.\d+$/u.test(tag.version))
    .sort((left, right) => compareVersions(right.version, left.version));

  return tags[0]?.tag ?? null;
}

function compareVersions(left, right) {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);

  return (
    leftVersion.major - rightVersion.major ||
    leftVersion.minor - rightVersion.minor ||
    leftVersion.patch - rightVersion.patch
  );
}

function versionFromTag(tag, tagPrefix) {
  const prefix = `${tagPrefix}@`;

  if (!tag.startsWith(prefix)) {
    throw new Error(`Tag ${tag} does not match package prefix ${tagPrefix}`);
  }

  return tag.slice(prefix.length);
}

function commitsForPackage(config, lastTag) {
  if (lastTag === null) {
    return [];
  }

  const range = `${lastTag}..HEAD`;
  const output = execFileSync(
    'git',
    ['log', '--format=%H%x1f%s%x1f%b%x1e', range, '--', ...config.paths],
    {
      encoding: 'utf8',
    },
  );

  return output
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, subject, body = ''] = record.split('\x1f');

      return {
        body,
        hash,
        subject,
      };
    });
}

function buildReleasePlans({ date = currentDate() } = {}) {
  return PACKAGE_CONFIGS.map((config) => {
    const lastTag = latestTagFor(config);
    const currentVersion = readPackageVersion(config);
    const plan = planPackageRelease({
      commits: commitsForPackage(config, lastTag),
      currentVersion,
      date,
      hasCurrentChangelogEntry: currentChangelogHasVersion(config, currentVersion),
      lastTag,
      name: config.name,
      tagPrefix: config.tagPrefix,
    });

    if (plan.release && plan.bump === 'pending') {
      return {
        ...plan,
        releaseSha: pendingReleaseShaFor(config, plan, lastTag),
      };
    }

    return plan;
  });
}

function currentChangelogHasVersion(config, version) {
  return (
    existsSync(config.changelogPath) &&
    changelogHasVersion(readFileSync(config.changelogPath, 'utf8'), version)
  );
}

function pendingReleaseShaFor(config, plan, lastTag) {
  const releaseSha = findReleaseMetadataCommit(config, plan.nextVersion, lastTag);

  if (releaseSha === null) {
    throw new Error(`Could not find release metadata commit for ${plan.tag}`);
  }

  const laterPackageCommits = execFileSync(
    'git',
    ['log', '--format=%H', `${releaseSha}..HEAD`, '--', ...config.paths],
    {
      encoding: 'utf8',
    },
  ).trim();

  if (laterPackageCommits !== '') {
    throw new Error(
      `Pending release ${plan.tag} has package changes after release metadata commit ${releaseSha}`,
    );
  }

  return releaseSha;
}

function findReleaseMetadataCommit(config, version, lastTag) {
  const range = lastTag === null ? [] : [`${lastTag}..HEAD`];
  const commits = execFileSync(
    'git',
    ['log', '--reverse', '--format=%H', ...range, '--', config.changelogPath],
    {
      encoding: 'utf8',
    },
  )
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean);

  return (
    commits.find((commit) => commitFileHasVersion(commit, config.changelogPath, version)) ?? null
  );
}

function commitFileHasVersion(commit, path, version) {
  try {
    return changelogHasVersion(
      execFileSync('git', ['show', `${commit}:${path}`], {
        encoding: 'utf8',
      }),
      version,
    );
  } catch {
    return false;
  }
}

function readReleaseFiles() {
  const files = new Map();

  for (const config of PACKAGE_CONFIGS) {
    for (const versionFile of config.versionFiles) {
      files.set(versionFile, readFileSync(versionFile, 'utf8'));
    }
    if (existsSync(config.changelogPath)) {
      files.set(config.changelogPath, readFileSync(config.changelogPath, 'utf8'));
    }
  }

  return files;
}

function writeReleaseFiles(files) {
  for (const [path, content] of files) {
    writeFileSync(path, content);
  }
}

function writeGithubOutput(path, plans) {
  if (path === null) {
    return;
  }

  const releasedPlans = plans.filter((plan) => plan.release);
  const lines = [
    `has_releases=${String(releasedPlans.length > 0)}`,
    `released_packages=${releasedPlans.map((plan) => plan.name).join(',')}`,
  ];

  for (const config of PACKAGE_CONFIGS) {
    const plan = plans.find((candidate) => candidate.name === config.name);
    lines.push(`${config.id}_released=${String(plan?.release ?? false)}`);
    lines.push(`${config.id}_version=${plan?.nextVersion ?? ''}`);
    lines.push(`${config.id}_tag=${plan?.tag ?? ''}`);
    lines.push(`${config.id}_sha=${plan?.releaseSha ?? ''}`);
  }

  writeFileSync(path, `${lines.join(EOL)}${EOL}`, {
    flag: 'a',
  });
}

function parseCliArgs(argv) {
  const options = {
    command: argv[2] ?? 'plan',
    githubOutput: null,
    planFile: 'release-plan.json',
  };

  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--github-output') {
      index += 1;
      options.githubOutput = argv[index] ?? null;
    } else if (arg === '--plan-file') {
      index += 1;
      options.planFile = argv[index] ?? options.planFile;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function runCli(argv) {
  const options = parseCliArgs(argv);
  const plans = buildReleasePlans();
  const releasePlans = plans.filter((plan) => plan.release);

  if (options.command === 'plan') {
    process.stdout.write(`${JSON.stringify(plans, null, 2)}\n`);
    return;
  }

  if (options.command === 'prepare') {
    const files = applyReleasePlan({
      files: readReleaseFiles(),
      plans: releasePlans,
    });

    writeReleaseFiles(files);
    writeFileSync(options.planFile, `${JSON.stringify(releasePlans, null, 2)}\n`);
    writeGithubOutput(options.githubOutput, plans);
    process.stdout.write(`${JSON.stringify(releasePlans, null, 2)}\n`);
    return;
  }

  throw new Error(`Unknown command: ${options.command}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv);
}

export { applyReleasePlan, PACKAGE_CONFIGS, planPackageRelease };
