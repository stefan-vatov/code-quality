import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { addInternalExportDocs } from './internal/internal-export-docs';
import { addVoidReturnTypes } from './internal/explicit-return-types';
import { formatFileHeaderComment } from './internal/format-file-header';
import { formatJSDocComments } from './internal/format-jsdoc-comments';
import { inlineLocalExportLists } from './internal/inline-export-lists';
import { preferConciseArrowBodies } from './internal/arrow-body-style';
import { preferExplicitBranches } from './internal/no-ternary';
import { preferFunctionExpressions } from './internal/function-declarations';
import { resolve } from 'node:path';
import { sortImportDeclarations } from './internal/sort-imports';

const defaultPaths = ['src'] as const;
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts']);
const ignoredDirectories = new Set(['bench', 'dist', 'fixtures', 'node_modules', 'test']);

export interface CodemodFixOptions {
  cwd?: string;
  dryRun?: boolean;
  paths?: readonly string[];
}

export interface CodemodFixResult {
  changedFiles: string[];
  scannedFiles: number;
}

const hasSourceExtension = (path: string): boolean =>
  [...sourceExtensions].some((extension) => path.endsWith(extension));

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

export const applyCodemodFixToSource = (source: string): string =>
  formatJSDocComments(
    addInternalExportDocs(
      inlineLocalExportLists(
        addVoidReturnTypes(
          preferConciseArrowBodies(
            preferExplicitBranches(preferFunctionExpressions(sortImportDeclarations(source))),
          ),
        ),
      ),
    ),
  );

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
