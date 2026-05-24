/* -------------------------------------------------------------------------- */
/* Public API for running The Thracian codemod fixes from package scripts or  */
/*                                   Tools.                                   */
/* -------------------------------------------------------------------------- */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { addInternalExportDocs } from '../codemods/internal-export-docs';
import { addVoidReturnTypes } from '../codemods/explicit-return-types';
import { formatFileHeaderComment } from '../codemods/format-file-header';
import { formatJSDocComments } from '../codemods/format-jsdoc-comments';
import { inlineLocalExportLists } from '../codemods/inline-export-lists';
import { preferConciseArrowBodies } from '../codemods/arrow-body-style';
import { preferExplicitBranches } from '../codemods/no-ternary';
import { preferFunctionExpressions } from '../codemods/function-declarations';
import { renameMisCasedAcronyms } from '../codemods/rename-acronyms';
import { resolve } from 'node:path';
import { sortImportDeclarations } from '../codemods/sort-imports';

const defaultPaths = ['src'] as const;
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts']);
const ignoredDirectories = new Set(['bench', 'dist', 'fixtures', 'node_modules', 'test']);

/**
 * Options for running The Thracian codemod fixer.
 *
 * @public
 */
export interface CodemodFixOptions {
  cwd?: string;
  dryRun?: boolean;
  paths?: readonly string[];
}

/**
 * Summary returned after scanning and optionally rewriting source files.
 *
 * @public
 */
export interface CodemodFixResult {
  changedFiles: string[];
  scannedFiles: number;
}

const hasSourceExtension = (path: string): boolean =>
  [...sourceExtensions].some((extension) => path.endsWith(extension));

/**
 * Lists TypeScript source files under a root directory.
 *
 * @public
 */
export const sourceFilesUnder = (root: string): string[] => {
  const files: string[] = [];

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = resolve(directory, entry);
      const stats = statSync(path);

      if (stats.isDirectory()) {
        if (!ignoredDirectories.has(entry)) {
          visit(path);
        }
      } else if (stats.isFile() && hasSourceExtension(path)) {
        files.push(path);
      }
    }
  };

  visit(root);
  return files;
};

/**
 * Applies all safe codemod fixes to a single source string.
 *
 * @public
 */
export const applyCodemodFixToSource = (source: string): string =>
  formatJSDocComments(
    addInternalExportDocs(
      inlineLocalExportLists(
        addVoidReturnTypes(
          preferConciseArrowBodies(
            preferExplicitBranches(
              preferFunctionExpressions(sortImportDeclarations(renameMisCasedAcronyms(source))),
            ),
          ),
        ),
      ),
    ),
  );

/**
 * Applies all safe codemod fixes to one file.
 *
 * @public
 */
export const applyCodemodFixToFile = (path: string, dryRun: boolean): boolean => {
  const before = readFileSync(path, 'utf8');
  const after = formatFileHeaderComment(applyCodemodFixToSource(before));

  if (after === before) {
    return false;
  }

  if (!dryRun) {
    writeFileSync(path, after);
  }
  return true;
};

const candidateFiles = (path: string): string[] => {
  const stats = statSync(path);
  if (stats.isDirectory()) {
    return sourceFilesUnder(path);
  }
  return [path];
};

/**
 * Runs The Thracian codemod fixer across configured paths.
 *
 * @public
 */
export const codemodFix = (options: CodemodFixOptions = {}): CodemodFixResult => {
  const cwd = options.cwd ?? process.cwd();
  const paths = ((): readonly string[] => {
    if (options.paths && options.paths.length > 0) {
      return options.paths;
    }
    return defaultPaths;
  })();
  const dryRun = options.dryRun ?? false;
  const changedFiles: string[] = [];
  let scannedFiles = 0;

  for (const path of paths) {
    scannedFiles += scanPath(cwd, path, dryRun, changedFiles);
  }

  return { changedFiles, scannedFiles };
};

const collectChangedFile = (changedFiles: string[], file: string, dryRun: boolean): void => {
  if (applyCodemodFixToFile(file, dryRun)) {
    changedFiles.push(file);
  }
};

const scanPath = (cwd: string, path: string, dryRun: boolean, changedFiles: string[]): number => {
  let scannedFiles = 0;
  for (const file of candidateFiles(resolve(cwd, path))) {
    if (hasSourceExtension(file)) {
      scannedFiles += 1;
      collectChangedFile(changedFiles, file, dryRun);
    }
  }
  return scannedFiles;
};
