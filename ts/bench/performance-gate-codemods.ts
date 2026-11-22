import { addInternalExportDocs } from '../src/codemod-fix/internal/internal-export-docs';
import { addVoidReturnTypes } from '../src/codemod-fix/internal/explicit-return-types';
import { applyCodemodFixToSource } from '../src/codemod-fix/index';
import { formatFileHeaderComment } from '../src/codemod-fix/internal/format-file-header';
import { formatJSDocComments } from '../src/codemod-fix/internal/format-jsdoc-comments';
import { inlineLocalExportLists } from '../src/codemod-fix/internal/inline-export-lists';
import { preferConciseArrowBodies } from '../src/codemod-fix/internal/arrow-body-style';
import { preferExplicitBranches } from '../src/codemod-fix/internal/no-ternary';
import { preferFunctionExpressions } from '../src/codemod-fix/internal/function-declarations';
import { sortImportDeclarations } from '../src/codemod-fix/internal/sort-imports';

export const benchmarkCodemodFixtures = [
  `
    import zed from './zed'; import { beta, alpha } from './letters'; const apiUrl = '/users';
    const helper = () => { return apiUrl; };
    function value() { return undefined; } export { helper, value };
  `,
  `
    /** Internal helper exported for package-local composition. */
    export const run = (input: string) => { if (input) { return "ok"; } else { return "bad"; } };
  `,
  `const result = enabled ? makeEnabled() : makeDisabled(); export const mapper = (value: string) => { return { value }; };`,
  `export function parse(input: string) { return undefined; } export const httpApi = () => fetch('/users');`,
];

export const benchmarkCodemods = {
  addInternalExportDocs,
  addVoidReturnTypes,
  applyCodemodFixToSource,
  formatFileHeaderComment,
  formatJSDocComments,
  inlineLocalExportLists,
  preferConciseArrowBodies,
  preferExplicitBranches,
  preferFunctionExpressions,
  sortImportDeclarations,
} satisfies Record<string, (source: string) => string>;
