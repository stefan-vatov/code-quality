#!/usr/bin/env node

import { Effect, Exit } from 'effect';

const dryRunFlag = '--dry-run';
const jscodeshiftRange = '^17.4.0';

const hasJscodeshift = Exit.isSuccess(
  Effect.runSyncExit(Effect.try(() => import.meta.resolve('jscodeshift'))),
);

const writeMissingPeerHint = (): void => {
  process.stderr.write(
    'thx-codemod-fix requires the optional peer dependency jscodeshift.\n' +
      `Install it with: npm install --save-dev jscodeshift@${jscodeshiftRange}\n`,
  );
  process.exitCode = 1;
};

const runCodemodFix = async (): Promise<void> => {
  const { codemodFix } = await import('./index');
  const rawArgs = process.argv.slice(2);
  const dryRun = rawArgs.includes(dryRunFlag);
  const paths = rawArgs.filter((arg): boolean => arg !== dryRunFlag);
  const result = codemodFix({ dryRun, paths });
  const mode = ((): string => {
    if (dryRun) {
      return 'Would apply';
    }
    return 'Applied';
  })();

  process.stdout.write(
    `${mode} The Thracian codemod fixes to ${result.changedFiles.length} file(s); ` +
      `scanned ${result.scannedFiles} file(s).\n`,
  );

  if (dryRun && result.changedFiles.length > 0) {
    process.exitCode = 1;
  }
};

if (hasJscodeshift) {
  await runCodemodFix();
} else {
  writeMissingPeerHint();
}
