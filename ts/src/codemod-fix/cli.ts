#!/usr/bin/env node
/** @internal CLI entry point for running The Thracian codemod fixes. */
import { codemodFix } from './index';

const dryRunFlag = '--dry-run';
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
