import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { addInternalExportDocs } from '../../src/codemods/internal-export-docs';
import { addVoidReturnTypes } from '../../src/codemods/explicit-return-types';
import { formatFileHeaderComment } from '../../src/codemods/format-file-header';
import { formatJSDocComments } from '../../src/codemods/format-jsdoc-comments';
import { inlineLocalExportLists } from '../../src/codemods/inline-export-lists';
import { join } from 'node:path';
import { preferConciseArrowBodies } from '../../src/codemods/arrow-body-style';
import { preferExplicitBranches } from '../../src/codemods/no-ternary';
import { preferFunctionExpressions } from '../../src/codemods/function-declarations';
import { renameMisCasedAcronyms } from '../../src/codemods/rename-acronyms';
import { sortImportDeclarations } from '../../src/codemods/sort-imports';
import { spawnSync } from 'node:child_process';
import theThracianOxlint from '../../src/index';

type CodemodQualityCase = {
  readonly name: string;
  readonly source: string;
};

type CodemodQualitySubject = {
  readonly cases: readonly CodemodQualityCase[];
  readonly name: string;
  readonly transform: (source: string) => string;
};

const outputRoot = 'ts/codemod-quality-output';
const outputOxlintConfig = join(outputRoot, 'oxlint.config.json');
const minimumCasesPerCodemod = 40;

const moduleHeader = `/* -------------------------------------------------------------------------- */
/*                    Codemod generated quality gate sample.                  */
/* -------------------------------------------------------------------------- */
`;

const internalModuleHeader = `/* -------------------------------------------------------------------------- */
/*              Internal codemod generated quality gate sample.              */
/* -------------------------------------------------------------------------- */
`;

const moduleScopePreamble = `import type { ASTPath as CodemodQualityModuleScope } from 'jscodeshift';

type CodemodQualitySentinel = CodemodQualityModuleScope;
const codemodQualitySentinel = undefined as CodemodQualitySentinel | undefined;
void codemodQualitySentinel;

`;

const withHeader = (body: string): string => `${moduleHeader}${moduleScopePreamble}${body}`;

const withImportHeader = (body: string): string => `${moduleHeader}${body}`;

const withInternalHeader = (body: string): string =>
  `${internalModuleHeader}${moduleScopePreamble}${body}`;

const internalDeclarationDoc = `/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
`;

const subprocessEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  return env;
};

const codemods = [
  {
    cases: [
      {
        name: 'trim-return',
        source: withHeader(`const formatName = (name: string): string => {
  return name.trim();
};

const result = formatName('Ada');
void result;
`),
      },
      {
        name: 'object-return',
        source: withHeader(`const buildUser = (name: string): { readonly name: string } => {
  return { name };
};

const result = buildUser('Ada');
void result;
`),
      },
      {
        name: 'boolean-return',
        source: withHeader(`const hasValue = (value: string): boolean => {
  return value.length > 0;
};

const result = hasValue('Ada');
void result;
`),
      },
      {
        name: 'array-return',
        source: withHeader(`const splitName = (name: string): string[] => {
  return name.split(' ');
};

const result = splitName('Ada Lovelace');
void result;
`),
      },
      {
        name: 'number-return',
        source: withHeader(`const countLetters = (value: string): number => {
  return value.length;
};

const result = countLetters('Ada');
void result;
`),
      },
      {
        name: 'template-return',
        source: withHeader(`const formatLabel = (name: string): string => {
  return \`user:\${name}\`;
};

const result = formatLabel('Ada');
void result;
`),
      },
      {
        name: 'call-return',
        source: withHeader(`const normalizeName = (name: string): string => {
  return name.toLocaleLowerCase();
};

const result = normalizeName('ADA');
void result;
`),
      },
      {
        name: 'parenthesized-return',
        source: withHeader(`const combine = (left: number, right: number): number => {
  return (left + right);
};

const result = combine(1, 2);
void result;
`),
      },
      {
        name: 'nullish-return',
        source: withHeader(`const fallbackName = (name: string | undefined): string => {
  return name ?? 'anonymous';
};

const result = fallbackName(undefined);
void result;
`),
      },
      {
        name: 'member-return',
        source: withHeader(`const firstName = (names: readonly string[]): string | undefined => {
  return names[0];
};

const result = firstName(['Ada']);
void result;
`),
      },
    ],
    name: 'arrow-body-style',
    transform: preferConciseArrowBodies,
  },
  {
    cases: [
      {
        name: 'block-arrow',
        source: withHeader(`const sendValue = (value: string) => {
  sink(value);
};

const sink = (value: string): void => {
  void value;
};

sendValue('ready');
`),
      },
      {
        name: 'async-arrow',
        source: withHeader(`const persistValue = async (value: string) => {
  await sink(value);
};

const sink = async (value: string): Promise<void> => {
  void value;
};

void persistValue('ready');
`),
      },
      {
        name: 'object-method',
        source: withHeader(`const visitor = {
  visit(node: object) {
    sink(node);
  },
};

const sink = (node: object): void => {
  void node;
};

visitor.visit({});
`),
      },
      {
        name: 'string-expression',
        source: withHeader(`const parseValue = (value: string) => value.trim();

const result = parseValue(' ready ');
void result;
`),
      },
      {
        name: 'boolean-expression',
        source: withHeader(`const hasToken = (value: string) => value.length > 0;

const result = hasToken('ready');
void result;
`),
      },
      {
        name: 'regexp-test',
        source: withHeader(`const hasEffectSignal = (source: string) => /Effect\\./u.test(source);

const result = hasEffectSignal('Effect.runSync');
void result;
`),
      },
      {
        name: 'literal-number',
        source: withHeader(`const countValues = () => 1;

const result = countValues();
void result;
`),
      },
      {
        name: 'literal-string',
        source: withHeader(`const buildValue = () => 'ready';

const result = buildValue();
void result;
`),
      },
      {
        name: 'void-function',
        source: withHeader(`const run = () => {
  sink('ready');
};

const sink = (value: string): void => {
  void value;
};

run();
`),
      },
      {
        name: 'visitor-factory',
        source: withHeader(`const rule = {
  ast: (context: object, source: string) => ({
    Program(node: object): void {
      sink(context, source, node);
    },
  }),
};

const sink = (context: object, source: string, node: object): void => {
  void context;
  void source;
  void node;
};

void rule;
`),
      },
    ],
    name: 'explicit-return-types',
    transform: addVoidReturnTypes,
  },
  {
    cases: [
      {
        name: 'file-purpose',
        source: `/** Internal helper module. */
${moduleScopePreamble}
const value = 1;
void value;
`,
      },
      {
        name: 'tagged-purpose',
        source: `/** Codemod helper module. @internal */\n${moduleScopePreamble}const value = 1;\nvoid value;\n`,
      },
      {
        name: 'wrapped-purpose',
        source: `/**\n * Codemod helper module.\n */\n${moduleScopePreamble}const value = 1;\nvoid value;\n`,
      },
      {
        name: 'with-import',
        source: `/** Import sorting sample module. */\nimport { Array } from 'effect';\n\nvoid Array;\n`,
      },
      {
        name: 'after-shebang',
        source: `#!/usr/bin/env node\n/** CLI sample module. */\n${moduleScopePreamble}const value = 1;\nvoid value;\n`,
      },
      {
        name: 'class-file',
        source: `/** User record module. */\n${moduleScopePreamble}class UserRecord {\n  readonly name = 'Ada';\n}\n\nvoid UserRecord;\n`,
      },
      {
        name: 'interface-file',
        source: `/** Options type module. */\n${moduleScopePreamble}interface Options {\n  readonly isEnabled: boolean;\n}\n\nconst options: Options = { isEnabled: true };\nvoid options;\n`,
      },
      {
        name: 'type-file',
        source: `/** Identifier type module. */\n${moduleScopePreamble}type Identifier = string;\n\nconst identifier: Identifier = 'ready';\nvoid identifier;\n`,
      },
      {
        name: 'enum-file',
        source: `/** Status enum module. */\n${moduleScopePreamble}enum Status {\n  Ready = 'ready',\n}\n\nconst status = Status.Ready;\nvoid status;\n`,
      },
      {
        name: 'function-file',
        source: `/** Function helper module. */\n${moduleScopePreamble}const formatName = (name: string): string => name.trim();\n\nconst result = formatName('Ada');\nvoid result;\n`,
      },
    ],
    name: 'format-file-header',
    transform: formatFileHeaderComment,
  },
  {
    cases: [
      {
        name: 'single-line-internal',
        source: withHeader(`/** @internal Sample helper. */\nconst value = 1;\nvoid value;\n`),
      },
      {
        name: 'single-line-public',
        source: withHeader(`/** @public Sample helper. */\nconst value = 1;\nvoid value;\n`),
      },
      {
        name: 'untagged-helper',
        source: withHeader(
          `/** Formats a sample value. */\nconst formatValue = (value: string): string => value.trim();\nvoid formatValue;\n`,
        ),
      },
      {
        name: 'inline-param',
        source: withHeader(
          `/** Formats a value. @param value - Source value. @returns Trimmed value. */\nconst formatValue = (value: string): string => value.trim();\nvoid formatValue;\n`,
        ),
      },
      {
        name: 'inline-return-tag',
        source: withHeader(
          `/** Builds a value. @returns Trimmed value. */\nconst buildValue = (): string => 'ready';\nvoid buildValue;\n`,
        ),
      },
      {
        name: 'existing-summary',
        source: withHeader(
          `/** Existing summary.\n * @internal\n */\nconst value = 1;\nvoid value;\n`,
        ),
      },
      {
        name: 'multi-tag',
        source: withHeader(
          `/** Builds config. @param value - Source value. @returns Result. @internal */\nconst buildConfig = (value: string): string => value.trim();\nvoid buildConfig;\n`,
        ),
      },
      {
        name: 'class-doc',
        source: withHeader(
          `/** Stores user details. */\nclass UserDetails {\n  readonly name = 'Ada';\n}\n\nvoid UserDetails;\n`,
        ),
      },
      {
        name: 'interface-doc',
        source: withHeader(
          `/** Configures behavior. */\ninterface Options {\n  readonly isEnabled: boolean;\n}\n\nconst options: Options = { isEnabled: true };\nvoid options;\n`,
        ),
      },
      {
        name: 'type-doc',
        source: withHeader(
          `/** Identifier alias. */\ntype Identifier = string;\n\nconst identifier: Identifier = 'ready';\nvoid identifier;\n`,
        ),
      },
    ],
    name: 'format-jsdoc-comments',
    transform: formatJSDocComments,
  },
  {
    cases: [
      {
        name: 'plain-function',
        source: withHeader(
          `function formatName(name: string): string {\n  const formatted = name.trim();\n  return formatted;\n}\n\nconst result = formatName('Ada');\nvoid result;\n`,
        ),
      },
      {
        name: 'generic-function',
        source: withHeader(
          `function identity<Value>(value: Value): Value {\n  const selected = value;\n  return selected;\n}\n\nconst result = identity('Ada');\nvoid result;\n`,
        ),
      },
      {
        name: 'nested-function',
        source: withHeader(
          `const run = (): void => {\n  function visit(value: string): void {\n    sink(value);\n  }\n\n  visit('ready');\n};\n\nconst sink = (value: string): void => {\n  void value;\n};\n\nrun();\n`,
        ),
      },
      {
        name: 'exported-function',
        source: withHeader(
          `/** Formats a name.\n *\n * @internal\n */\nexport function formatName(name: string): string {\n  const formatted = name.trim();\n  return formatted;\n}\n`,
        ),
      },
      {
        name: 'async-function',
        source: withHeader(
          `async function loadValue(value: string): Promise<string> {\n  const formatted = value.trim();\n  return formatted;\n}\n\nvoid loadValue('Ada');\n`,
        ),
      },
      {
        name: 'array-helper',
        source: withHeader(
          `function collectValues(values: readonly string[]): string[] {\n  const collected = [...values];\n  return collected;\n}\n\nconst result = collectValues(['Ada']);\nvoid result;\n`,
        ),
      },
      {
        name: 'boolean-helper',
        source: withHeader(
          `function hasValue(value: string): boolean {\n  const isPresent = value.length > 0;\n  return isPresent;\n}\n\nconst result = hasValue('Ada');\nvoid result;\n`,
        ),
      },
      {
        name: 'object-helper',
        source: withHeader(
          `function buildUser(name: string): { readonly name: string } {\n  const user = { name };\n  return user;\n}\n\nconst result = buildUser('Ada');\nvoid result;\n`,
        ),
      },
      {
        name: 'number-helper',
        source: withHeader(
          `function countValues(values: readonly string[]): number {\n  const count = values.length;\n  return count;\n}\n\nconst result = countValues(['Ada']);\nvoid result;\n`,
        ),
      },
      {
        name: 'union-helper',
        source: withHeader(
          `function normalizeValue(value: string | number): string {\n  const normalized = String(value);\n  return normalized;\n}\n\nconst result = normalizeValue(1);\nvoid result;\n`,
        ),
      },
    ],
    name: 'function-declarations',
    transform: preferFunctionExpressions,
  },
  {
    cases: [
      {
        name: 'const-export',
        source: withInternalHeader(
          `${internalDeclarationDoc}const value = 1;\n\nexport { value };\n`,
        ),
      },
      {
        name: 'arrow-export',
        source: withInternalHeader(
          `${internalDeclarationDoc}const formatName = (name: string): string => name.trim();\n\nexport { formatName };\n`,
        ),
      },
      {
        name: 'interface-export',
        source: withInternalHeader(
          `${internalDeclarationDoc}interface Options {\n  readonly isEnabled: boolean;\n}\n\nexport type { Options };\n`,
        ),
      },
      {
        name: 'type-export',
        source: withInternalHeader(
          `${internalDeclarationDoc}type Identifier = string;\n\nexport type { Identifier };\n`,
        ),
      },
      {
        name: 'class-export',
        source: withInternalHeader(
          `${internalDeclarationDoc}class UserRecord {\n  readonly name = 'Ada';\n}\n\nexport { UserRecord };\n`,
        ),
      },
      {
        name: 'enum-export',
        source: withInternalHeader(
          `${internalDeclarationDoc}enum Status {\n  Ready = 'ready',\n}\n\nexport { Status };\n`,
        ),
      },
      {
        name: 'multiple-export',
        source: withInternalHeader(
          `${internalDeclarationDoc}const alpha = 1;\n${internalDeclarationDoc}const beta = 2;\n\nexport { alpha, beta };\n`,
        ),
      },
      {
        name: 'mixed-export',
        source: withInternalHeader(
          `${internalDeclarationDoc}interface Options {\n  readonly isEnabled: boolean;\n}\n${internalDeclarationDoc}const run = (): void => {};\n\nexport { run, type Options };\n`,
        ),
      },
      {
        name: 'already-exported',
        source: withInternalHeader(
          `${internalDeclarationDoc}export const value = 1;\n\nexport { value };\n`,
        ),
      },
      {
        name: 'const-update-export',
        source: withInternalHeader(
          `${internalDeclarationDoc}const count = 1;\n\nexport { count };\n`,
        ),
      },
    ],
    name: 'inline-export-lists',
    transform: inlineLocalExportLists,
  },
  {
    cases: [
      {
        name: 'export-const',
        source: withInternalHeader(`export const value = 1;\n`),
      },
      {
        name: 'export-arrow',
        source: withInternalHeader(`export const run = (): void => {};\n`),
      },
      {
        name: 'export-class',
        source: withInternalHeader(`export class UserRecord {\n  readonly name = 'Ada';\n}\n`),
      },
      {
        name: 'export-interface',
        source: withInternalHeader(
          `export interface Options {\n  readonly isEnabled: boolean;\n}\n`,
        ),
      },
      {
        name: 'export-type',
        source: withInternalHeader(`export type Identifier = string;\n`),
      },
      {
        name: 'export-enum',
        source: withInternalHeader(`export enum Status {\n  Ready = 'ready',\n}\n`),
      },
      {
        name: 'two-exports',
        source: withInternalHeader(`export const alpha = 1;\nexport const beta = 2;\n`),
      },
      {
        name: 'documented-export',
        source: withInternalHeader(`${internalDeclarationDoc}export const value = 1;\n`),
      },
      {
        name: 'sync-export',
        source: withInternalHeader(`export const loadValue = (): string => 'ready';\n`),
      },
      {
        name: 'object-export',
        source: withInternalHeader(`export const options = { isEnabled: true };\n`),
      },
    ],
    name: 'internal-export-docs',
    transform: addInternalExportDocs,
  },
  {
    cases: [
      {
        name: 'return-string',
        source: withHeader(
          `const label = (isEnabled: boolean): string => isEnabled ? 'on' : 'off';\nconst result = label(true);\nvoid result;\n`,
        ),
      },
      {
        name: 'return-number',
        source: withHeader(
          `const pickCount = (isEnabled: boolean): number => isEnabled ? 1 : 2;\nconst result = pickCount(true);\nvoid result;\n`,
        ),
      },
      {
        name: 'return-boolean',
        source: withHeader(
          `const hasAccess = (isEnabled: boolean): boolean => isEnabled ? true : false;\nconst result = hasAccess(true);\nvoid result;\n`,
        ),
      },
      {
        name: 'function-return',
        source: withHeader(
          `const label = (isEnabled: boolean): string => {\n  return isEnabled ? 'on' : 'off';\n};\n\nconst result = label(true);\nvoid result;\n`,
        ),
      },
      {
        name: 'variable-string',
        source: withHeader(
          `const isEnabled = true;\nconst label = isEnabled ? 'on' : 'off';\nvoid label;\n`,
        ),
      },
      {
        name: 'variable-number',
        source: withHeader(
          `const isEnabled = true;\nconst count = isEnabled ? 1 : 2;\nvoid count;\n`,
        ),
      },
      {
        name: 'variable-boolean',
        source: withHeader(
          `const isEnabled = true;\nconst hasAccess = isEnabled ? true : false;\nvoid hasAccess;\n`,
        ),
      },
      {
        name: 'assignment-string',
        source: withHeader(
          `const isEnabled = true;\nlet label = '';\nlabel = isEnabled ? 'on' : 'off';\nvoid label;\n`,
        ),
      },
      {
        name: 'typed-variable',
        source: withHeader(
          `const isEnabled = true;\nconst label: string = isEnabled ? 'on' : 'off';\nvoid label;\n`,
        ),
      },
      {
        name: 'branch-repair',
        source: withHeader(
          `const isEnabled = true;\nlet label;\nif (isEnabled) {\n  label = 'on';\n} else {\n  label = 'off';\n}\nvoid label;\n`,
        ),
      },
    ],
    name: 'no-ternary',
    transform: preferExplicitBranches,
  },
  {
    cases: [
      {
        name: 'function-name',
        source: withHeader(
          `const parseJson = (jsonValue: string): string => jsonValue;\nconst result = parseJson('ready');\nvoid result;\n`,
        ),
      },
      {
        name: 'class-name',
        source: withHeader(
          `class ApiClient {\n  readonly endpoint = 'ready';\n}\nvoid ApiClient;\n`,
        ),
      },
      {
        name: 'method-name',
        source: withHeader(
          `const client = {\n  parseUrl(value: string): string {\n    return value;\n  },\n};\nconst result = client.parseUrl('ready');\nvoid result;\n`,
        ),
      },
      {
        name: 'variable-name',
        source: withHeader(`const httpResponseCode = 200;\nvoid httpResponseCode;\n`),
      },
      {
        name: 'parameter-name',
        source: withHeader(
          `const parse = (jsonValue: string): string => jsonValue;\nconst result = parse('ready');\nvoid result;\n`,
        ),
      },
      {
        name: 'reference-name',
        source: withHeader(
          `const xmlParser = (value: string): string => value;\nconst parse = xmlParser;\nvoid parse;\n`,
        ),
      },
      {
        name: 'object-method-call',
        source: withHeader(
          `const parser = {\n  parseJson(value: string): string {\n    return value;\n  },\n};\nconst result = parser.parseJson('ready');\nvoid result;\n`,
        ),
      },
      {
        name: 'nested-reference',
        source: withHeader(
          `const createUrl = (value: string): URL => new URL(value);\nconst result = createUrl('https://example.com');\nvoid result;\n`,
        ),
      },
      {
        name: 'array-callback',
        source: withHeader(
          `const parseIds = (ids: readonly string[]): string[] => ids.map((idValue) => idValue.trim());\nconst result = parseIds([' ready ']);\nvoid result;\n`,
        ),
      },
      {
        name: 'class-member-reference',
        source: withHeader(
          `class ApiService {\n  readonly baseUrl = 'https://example.com';\n}\nvoid ApiService;\n`,
        ),
      },
    ],
    name: 'rename-acronyms',
    transform: renameMisCasedAcronyms,
  },
  {
    cases: [
      {
        name: 'declarations',
        source: withImportHeader(
          `import { Array } from 'effect';\nimport { NodeRuntime } from '@effect/platform-node';\n\nvoid Array;\nvoid NodeRuntime;\n`,
        ),
      },
      {
        name: 'named-specifiers',
        source: withImportHeader(
          `import { pipe, Option, Array } from 'effect';\n\nvoid Array;\nvoid Option;\nvoid pipe;\n`,
        ),
      },
      {
        name: 'type-imports',
        source: withImportHeader(
          `import type { ASTPath, Collection } from 'jscodeshift';\n\ntype Entry = ASTPath | Collection;\nconst entry = undefined as Entry | undefined;\nvoid entry;\n`,
        ),
      },
      {
        name: 'mixed-groups',
        source: withImportHeader(
          `import { NodeRuntime } from '@effect/platform-node';\nimport type { ASTPath } from 'jscodeshift';\nimport { Array } from 'effect';\n\ntype Entry = ASTPath;\nconst entry = undefined as Entry | undefined;\nvoid Array;\nvoid entry;\nvoid NodeRuntime;\n`,
        ),
      },
      {
        name: 'single-member',
        source: withImportHeader(
          `import { Option } from 'effect';\nimport { NodeRuntime } from '@effect/platform-node';\n\nvoid NodeRuntime;\nvoid Option;\n`,
        ),
      },
      {
        name: 'aliased-named',
        source: withImportHeader(
          `import { Array as EffectArray, Option as EffectOption } from 'effect';\n\nvoid EffectArray;\nvoid EffectOption;\n`,
        ),
      },
      {
        name: 'multiple-named-lines',
        source: withImportHeader(
          `import {\n  pipe,\n  Option,\n  Array,\n} from 'effect';\n\nvoid Array;\nvoid Option;\nvoid pipe;\n`,
        ),
      },
      {
        name: 'comparison-source',
        source: withImportHeader(
          `import { Order } from 'effect';\nimport { NodeRuntime } from '@effect/platform-node';\n\nvoid NodeRuntime;\nvoid Order;\n`,
        ),
      },
      {
        name: 'predicate-source',
        source: withImportHeader(
          `import { Predicate } from 'effect';\nimport { NodeRuntime } from '@effect/platform-node';\n\nvoid NodeRuntime;\nvoid Predicate;\n`,
        ),
      },
      {
        name: 'schema-source',
        source: withImportHeader(
          `import { Schema } from 'effect';\nimport { NodeRuntime } from '@effect/platform-node';\n\nvoid NodeRuntime;\nvoid Schema;\n`,
        ),
      },
    ],
    name: 'sort-imports',
    transform: sortImportDeclarations,
  },
] satisfies readonly CodemodQualitySubject[];

const extraCasesByCodemod = {
  'arrow-body-style': [
    {
      name: 'readonly-tuple-return',
      source:
        withHeader(`const pairValues = (left: string, right: string): readonly [string, string] => {
  return [left, right] as const;
};

const result = pairValues('left', 'right');
void result;
`),
    },
    {
      name: 'generic-identity-return',
      source: withHeader(`const identity = <Value>(value: Value): Value => {
  return value;
};

const result = identity('ready');
void result;
`),
    },
    {
      name: 'property-access-return',
      source: withHeader(`const getLength = (value: string): number => {
  return value.length;
};

const result = getLength('ready');
void result;
`),
    },
    {
      name: 'logical-return',
      source: withHeader(`const hasBoth = (left: string, right: string): boolean => {
  return left.length > 0 && right.length > 0;
};

const result = hasBoth('a', 'b');
void result;
`),
    },
    {
      name: 'unary-return',
      source: withHeader(`const isEmpty = (value: string): boolean => {
  return !value.length;
};

const result = isEmpty('');
void result;
`),
    },
    {
      name: 'template-expression-return',
      source: withHeader(`const joinLabels = (left: string, right: string): string => {
  return \`\${left}:\${right}\`;
};

const result = joinLabels('a', 'b');
void result;
`),
    },
    {
      name: 'new-expression-return',
      source: withHeader(`const buildURL = (value: string): URL => {
  return new URL(value);
};

const result = buildURL('https://example.com');
void result;
`),
    },
    {
      name: 'array-copy-return',
      source: withHeader(`const readonlyNames = (names: readonly string[]): readonly string[] => {
  return [...names];
};

const result = readonlyNames(['Ada']);
void result;
`),
    },
    {
      name: 'two-statement-block-preserved',
      source: withHeader(`const normalizeName = (name: string): string => {
  const normalized = name.trim();
  return normalized;
};

const result = normalizeName(' Ada ');
void result;
`),
    },
    {
      name: 'if-block-preserved',
      source: withHeader(`const normalizeName = (name: string): string => {
  if (name.length === 0) {
    return 'anonymous';
  }
  return name.trim();
};

const result = normalizeName('Ada');
void result;
`),
    },
    {
      name: 'throw-block-preserved',
      source: withHeader(`const requireName = (name: string): string => {
  if (name.length === 0) {
    throw new Error('name is required');
  }
  return name;
};

const result = requireName('Ada');
void result;
`),
    },
    {
      name: 'object-spread-return',
      source:
        withHeader(`const cloneUser = (user: { readonly name: string }): { readonly name: string } => {
  return { ...user };
};

const result = cloneUser({ name: 'Ada' });
void result;
`),
    },
    {
      name: 'array-spread-return',
      source: withHeader(`const cloneNames = (names: readonly string[]): string[] => {
  return [...names];
};

const result = cloneNames(['Ada']);
void result;
`),
    },
    {
      name: 'optional-chain-return',
      source:
        withHeader(`const firstName = (user: { readonly name?: string }): string | undefined => {
  return user.name?.trim();
};

const result = firstName({ name: 'Ada' });
void result;
`),
    },
    {
      name: 'nested-call-return',
      source: withHeader(`const formatName = (name: string): string => {
  return name.trim().toUpperCase();
};

const result = formatName('Ada');
void result;
`),
    },
  ],
  'explicit-return-types': [
    {
      name: 'block-arrow-already-typed',
      source: withHeader(`const run = (): void => {
  sink('ready');
};

const sink = (value: string): void => {
  void value;
};

run();
`),
    },
    {
      name: 'async-arrow-already-typed',
      source: withHeader(`const loadValue = async (): Promise<string> => 'ready';

void loadValue();
`),
    },
    {
      name: 'string-slice-expression',
      source: withHeader(`const takePrefix = (value: string) => value.slice(0, 2);

const result = takePrefix('ready');
void result;
`),
    },
    {
      name: 'string-uppercase-expression',
      source: withHeader(`const upperName = (value: string) => value.toUpperCase();

const result = upperName('ready');
void result;
`),
    },
    {
      name: 'boolean-negation-expression',
      source: withHeader(`const isMissing = (value: string) => !value.length;

const result = isMissing('');
void result;
`),
    },
    {
      name: 'boolean-comparison-expression',
      source: withHeader(`const hasMinimumLength = (value: string) => value.length > 2;

const result = hasMinimumLength('ready');
void result;
`),
    },
    {
      name: 'boolean-logical-expression',
      source:
        withHeader(`const hasBoth = (left: string, right: string) => left.length > 0 && right.length > 0;

const result = hasBoth('a', 'b');
void result;
`),
    },
    {
      name: 'literal-boolean-expression',
      source: withHeader(`const isReady = () => true;

const result = isReady();
void result;
`),
    },
    {
      name: 'literal-string-expression-edge',
      source: withHeader(`const buildLabel = () => 'ready';

const result = buildLabel();
void result;
`),
    },
    {
      name: 'literal-number-expression-edge',
      source: withHeader(`const buildCount = () => 1;

const result = buildCount();
void result;
`),
    },
    {
      name: 'literal-boolean-expression-edge',
      source: withHeader(`const hasAccess = () => true;

const result = hasAccess();
void result;
`),
    },
    {
      name: 'object-method-already-typed',
      source: withHeader(`const visitor = {
  visit(node: object): void {
    sink(node);
  },
};

const sink = (node: object): void => {
  void node;
};

visitor.visit({});
`),
    },
    {
      name: 'nested-function-already-typed',
      source: withHeader(`const run = (): void => {
  const visit = (value: string): void => {
    sink(value);
  };

  visit('ready');
};

const sink = (value: string): void => {
  void value;
};

run();
`),
    },
    {
      name: 'return-value-branch-preserved',
      source: withHeader(`const maybeValue = (isEnabled: boolean): string | undefined => {
  if (isEnabled) {
    return 'ready';
  }
  return undefined;
};

void maybeValue;
`),
    },
    {
      name: 'predicate-property-check',
      source: withHeader(`const rule = {
  check: (source: string) => source.length > 0,
};

const result = rule.check('ready');
void result;
`),
    },
  ],
  'format-file-header': [
    {
      name: 'already-divider-header',
      source: withHeader(`const value = 1;
void value;
`),
    },
    {
      name: 'long-jsdoc-header',
      source: `/** Codemod generated quality gate sample with a long enough purpose that it must wrap cleanly into the divider header format. */
${moduleScopePreamble}const value = 1;
void value;
`,
    },
    {
      name: 'leading-blank-lines',
      source: `

/** Leading whitespace module. */
${moduleScopePreamble}const value = 1;
void value;
`,
    },
    {
      name: 'multi-line-jsdoc-tags',
      source: `/**
 * Tagged helper module.
 *
 * @internal
 */
${moduleScopePreamble}const value = 1;
void value;
`,
    },
    {
      name: 'divider-header-rewrap',
      source: `/* -------------------------------------------------------------------------- */
/* Codemod generated quality gate sample with a long enough purpose that it must wrap cleanly into the divider header format. */
/* -------------------------------------------------------------------------- */
${moduleScopePreamble}const value = 1;
void value;
`,
    },
    {
      name: 'default-export-preserved',
      source: withHeader(`/**
 * Formats a value.
 */
const formatValue = (value: string): string => value.trim();

export default formatValue;
`),
    },
    {
      name: 'import-type-header',
      source: `/** Type import module. */
import type { ASTPath } from 'jscodeshift';

type Entry = ASTPath;
const entry = undefined as Entry | undefined;
void entry;
`,
    },
    {
      name: 'namespace-type-file',
      source: `/** Namespace type module. */
${moduleScopePreamble}interface Options {
  readonly isEnabled: boolean;
}

const options: Options = { isEnabled: true };
void options;
`,
    },
    {
      name: 'declaration-jsdoc-after-header',
      source: withHeader(`/**
 * Formats a value.
 */
const formatValue = (value: string): string => value.trim();

const result = formatValue('ready');
void result;
`),
    },
    {
      name: 'no-header-with-generated-description-absent',
      source: withHeader(`const value = 1;
void value;
`),
    },
    {
      name: 'shebang-with-divider',
      source: `#!/usr/bin/env node
/* -------------------------------------------------------------------------- */
/*                    Codemod generated quality gate sample.                  */
/* -------------------------------------------------------------------------- */
${moduleScopePreamble}const value = 1;
void value;
`,
    },
    {
      name: 'abstract-class-file',
      source: `/** Abstract user module. */
${moduleScopePreamble}abstract class UserModel {
  abstract readonly name: string;
}

void UserModel;
`,
    },
    {
      name: 'exported-const-file',
      source: `/** Exported value module. */
${moduleScopePreamble}${internalDeclarationDoc}export const value = 1;
`,
    },
    {
      name: 'let-file',
      source: `/** Mutable local module. */
${moduleScopePreamble}let count = 1;
count += 1;
void count;
`,
    },
    {
      name: 'var-file',
      source: `/** Legacy local module. */
${moduleScopePreamble}const value = 1;
void value;
`,
    },
  ],
  'format-jsdoc-comments': [
    {
      name: 'throws-tag',
      source: withHeader(`/** Requires a value. @throws When value is empty. */
const requireValue = (value: string): string => {
  if (value.length === 0) {
    throw new Error('value is required');
  }
  return value;
};

void requireValue;
`),
    },
    {
      name: 'example-tag',
      source: withHeader(`/** Formats a value. @example formatValue(' ready ') */
const formatValue = (value: string): string => value.trim();
void formatValue;
`),
    },
    {
      name: 'alpha-tag',
      source: withHeader(`/** Experimental value. @alpha */
const value = 1;
void value;
`),
    },
    {
      name: 'beta-tag',
      source: withHeader(`/** Beta value. @beta */
const value = 1;
void value;
`),
    },
    {
      name: 'param-only-multiline',
      source: withHeader(`/**
 * Formats a value. @param value - Source value.
 */
const formatValue = (value: string): string => value.trim();
void formatValue;
`),
    },
    {
      name: 'returns-only-multiline',
      source: withHeader(`/**
 * Builds a value. @returns Result value.
 */
const buildValue = (): string => 'ready';
void buildValue;
`),
    },
    {
      name: 'string-literal-ignored',
      source: withHeader(`const marker = '/** @internal sample. */';
void marker;
`),
    },
    {
      name: 'template-literal-ignored',
      source: withHeader('const marker = `/** @internal sample. */`;\nvoid marker;\n'),
    },
    {
      name: 'block-comment-ignored',
      source: withHeader(`const value = 1;
void value;
`),
    },
    {
      name: 'collapsed-public-param-return',
      source: withHeader(`/** Formats a value. @param value - Source. @returns Result. @public */
const formatValue = (value: string): string => value.trim();
void formatValue;
`),
    },
    {
      name: 'interface-inline-tag',
      source: withHeader(`/** Options contract. @internal */
interface Options {
  readonly isEnabled: boolean;
}

const options: Options = { isEnabled: true };
void options;
`),
    },
    {
      name: 'enum-inline-tag',
      source: withHeader(`/** Status values. @internal */
enum Status {
  Ready = 'ready',
}

const status = Status.Ready;
void status;
`),
    },
    {
      name: 'class-inline-tag',
      source: withHeader(`/** User details. @internal */
class UserDetails {
  readonly name = 'Ada';
}

void UserDetails;
`),
    },
    {
      name: 'type-inline-tag',
      source: withHeader(`/** Identifier alias. @internal */
type Identifier = string;

const identifier: Identifier = 'ready';
void identifier;
`),
    },
    {
      name: 'method-doc-inline-tag',
      source: withHeader(`const visitor = {
  /** Visits a node. @internal */
  visit(node: object): void {
    void node;
  },
};

void visitor;
`),
    },
  ],
  'function-declarations': [
    {
      name: 'typed-void-function',
      source: withHeader(`function run(): void {
  sink('ready');
}

const sink = (value: string): void => {
  void value;
};

run();
`),
    },
    {
      name: 'generic-constraint',
      source: withHeader(`function getName(value: { readonly name: string }): string {
  const { name } = value;
  return name;
}

const result = getName({ name: 'Ada' });
void result;
`),
    },
    {
      name: 'rest-parameters',
      source: withHeader(`function joinValues(...values: readonly string[]): string {
  const joined = values.join(':');
  return joined;
}

const result = joinValues('a', 'b');
void result;
`),
    },
    {
      name: 'default-parameter',
      source: withHeader(`function formatValue(value = 'ready'): string {
  const formatted = value.trim();
  return formatted;
}

const result = formatValue();
void result;
`),
    },
    {
      name: 'destructured-parameter',
      source: withHeader(`function formatUser(input: { readonly name: string }): string {
  const formatted = input.name.trim();
  return formatted;
}

const result = formatUser({ name: 'Ada' });
void result;
`),
    },
    {
      name: 'union-parameter-function',
      source: withHeader(`function parseValue(value: string | number): string {
  const parsed = String(value);
  return parsed;
}

const result = parseValue('ready');
void result;
`),
    },
    {
      name: 'default-export-preserved',
      source:
        withHeader(`${internalDeclarationDoc}export default function formatValue(value: string): string {
  const formatted = value.trim();
  return formatted;
}
`),
    },
    {
      name: 'object-parameter-function',
      source:
        withHeader(`function formatName(input: { readonly prefix: string; readonly name: string }): string {
  const formatted = input.prefix + input.name.trim();
  return formatted;
}

const result = formatName({ name: 'Ada', prefix: 'user:' });
void result;
`),
    },
    {
      name: 'later-reference-converted',
      source: withHeader(`function formatValue(value: string): string {
  const formatted = value.trim();
  return formatted;
}

const result = formatValue('ready');
void result;
`),
    },
    {
      name: 'nested-later-reference-converted',
      source: withHeader(`const run = (): void => {
  function visit(value: string): void {
    sink(value);
  }

  visit('ready');
};

const sink = (value: string): void => {
  void value;
};

run();
`),
    },
    {
      name: 'exported-generic-function',
      source:
        withInternalHeader(`${internalDeclarationDoc}export function identity<Value>(value: Value): Value {
  const selected = value;
  return selected;
}
`),
    },
    {
      name: 'async-void-function',
      source: withHeader(`async function persistValue(value: string): Promise<void> {
  await sink(value);
}

const sink = async (value: string): Promise<void> => {
  void value;
};

void persistValue('ready');
`),
    },
    {
      name: 'guard-function',
      source: withHeader(`function normalizeValue(value: string): string {
  if (value.length === 0) {
    return 'ready';
  }
  const normalized = value.trim();
  return normalized;
}

const result = normalizeValue('ready');
void result;
`),
    },
    {
      name: 'switch-function',
      source: withHeader(`function labelForStatus(status: 'ready' | 'pending'): string {
  switch (status) {
    case 'ready': {
      return 'Ready';
    }
    case 'pending': {
      return 'Pending';
    }
  }
  return status;
}

const result = labelForStatus('ready');
void result;
`),
    },
    {
      name: 'class-method-preserved',
      source: withHeader(`class Formatter {
  formatValue(value: string): string {
    return value.trim();
  }
}

void Formatter;
`),
    },
  ],
  'inline-export-lists': [
    {
      name: 'type-and-value-separate',
      source: withInternalHeader(`${internalDeclarationDoc}type Identifier = string;
${internalDeclarationDoc}const value: Identifier = 'ready';

export type { Identifier };
export { value };
`),
    },
    {
      name: 'reexport-preserved',
      source: withHeader(`export { Array } from 'effect';
`),
    },
    {
      name: 'aliased-export-preserved',
      source: withInternalHeader(`${internalDeclarationDoc}const internalValue = 1;

export { internalValue as publicValue };
`),
    },
    {
      name: 'default-export-list-preserved',
      source: withInternalHeader(`${internalDeclarationDoc}const value = 1;

export { value as default };
`),
    },
    {
      name: 'already-exported-type-list',
      source: withInternalHeader(`${internalDeclarationDoc}export type Identifier = string;

export type { Identifier };
`),
    },
    {
      name: 'exported-class-list-removal',
      source: withInternalHeader(`${internalDeclarationDoc}export class UserRecord {
  readonly name = 'Ada';
}

export { UserRecord };
`),
    },
    {
      name: 'exported-enum-list-removal',
      source: withInternalHeader(`${internalDeclarationDoc}export enum Status {
  Ready = 'ready',
}

export { Status };
`),
    },
    {
      name: 'multiline-export-list',
      source: withInternalHeader(`${internalDeclarationDoc}const alpha = 1;
${internalDeclarationDoc}const beta = 2;
${internalDeclarationDoc}const gamma = 3;

export {
  alpha,
  beta,
  gamma,
};
`),
    },
    {
      name: 'multiline-type-export-list',
      source: withInternalHeader(`${internalDeclarationDoc}interface Alpha {
  readonly value: string;
}
${internalDeclarationDoc}interface Beta {
  readonly value: string;
}

export type {
  Alpha,
  Beta,
};
`),
    },
    {
      name: 'mixed-already-exported-list',
      source: withInternalHeader(`${internalDeclarationDoc}export interface Options {
  readonly isEnabled: boolean;
}
${internalDeclarationDoc}export const run = (): void => {};

export {
  run,
  type Options,
};
`),
    },
    {
      name: 'namespace-export-preserved',
      source: withHeader(`export * from 'effect';
`),
    },
    {
      name: 'export-from-type-preserved',
      source: withHeader(`export type { ASTPath } from 'jscodeshift';
`),
    },
    {
      name: 'variable-declaration-multiple-declarators-preserved',
      source: withInternalHeader(`${internalDeclarationDoc}const alpha = 1;
${internalDeclarationDoc}const beta = 2;

export { alpha, beta };
`),
    },
    {
      name: 'interface-with-extends',
      source: withInternalHeader(`${internalDeclarationDoc}interface BaseOptions {
  readonly id: string;
}
${internalDeclarationDoc}interface Options extends BaseOptions {
  readonly isEnabled: boolean;
}

export type { BaseOptions, Options };
`),
    },
    {
      name: 'class-with-constructor',
      source: withInternalHeader(`${internalDeclarationDoc}class UserRecord {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }
}

export { UserRecord };
`),
    },
  ],
  'internal-export-docs': [
    {
      name: 'export-let',
      source: withInternalHeader(`export const count = 1;\n`),
    },
    {
      name: 'export-object',
      source: withInternalHeader(`export const config = {
  isEnabled: true,
};\n`),
    },
    {
      name: 'export-array',
      source: withInternalHeader(`export const values = ['ready'];\n`),
    },
    {
      name: 'export-generic-arrow',
      source: withInternalHeader(
        `export const identity = <Value>(value: Value): Value => value;\n`,
      ),
    },
    {
      name: 'export-type-union',
      source: withInternalHeader(`export type Status = 'ready' | 'pending';\n`),
    },
    {
      name: 'export-interface-extends',
      source: withInternalHeader(`interface BaseOptions {
  readonly id: string;
}

export interface Options extends BaseOptions {
  readonly isEnabled: boolean;
}\n`),
    },
    {
      name: 'export-abstract-class',
      source: withInternalHeader(`export abstract class UserModel {
  abstract readonly name: string;
}\n`),
    },
    {
      name: 'export-const-with-existing-block-comment',
      source: withInternalHeader(`/* Existing block comment. */
export const value = 1;\n`),
    },
    {
      name: 'public-file-preserved',
      source: withHeader(`${internalDeclarationDoc}export const value = 1;\n`),
    },
    {
      name: 'existing-doc-preserved',
      source: withInternalHeader(`${internalDeclarationDoc}export const value = 1;\n`),
    },
    {
      name: 'two-documented-exports-preserved',
      source: withInternalHeader(`${internalDeclarationDoc}export const alpha = 1;
${internalDeclarationDoc}export const beta = 2;\n`),
    },
    {
      name: 'exported-function-expression',
      source: withInternalHeader(
        `export const formatValue = (value: string): string => value.trim();\n`,
      ),
    },
    {
      name: 'exported-async-effectless-arrow',
      source: withInternalHeader(
        `export const formatValue = (value: string): string => value.trim();\n`,
      ),
    },
    {
      name: 'exported-enum-existing-doc',
      source: withInternalHeader(`${internalDeclarationDoc}export enum Status {
  Ready = 'ready',
}\n`),
    },
    {
      name: 'exported-class-existing-doc',
      source: withInternalHeader(`${internalDeclarationDoc}export class UserRecord {
  readonly name = 'Ada';
}\n`),
    },
  ],
  'no-ternary': [
    {
      name: 'assignment-number',
      source: withHeader(`const isEnabled = true;
let count = 0;
count = isEnabled ? 1 : 2;
void count;
`),
    },
    {
      name: 'assignment-boolean',
      source: withHeader(`const isEnabled = true;
let hasAccess = false;
hasAccess = isEnabled ? true : false;
void hasAccess;
`),
    },
    {
      name: 'nested-ternary-preserved',
      source: withHeader(`const label = (isEnabled: boolean, isPending: boolean): string => {
  if (isEnabled) {
    return 'on';
  }
  if (isPending) {
    return 'pending';
  }
  return 'off';
};

const result = label(true, false);
void result;
`),
    },
    {
      name: 'typed-undefined-variable',
      source: withHeader(`const isEnabled = true;
const value: string | undefined = isEnabled ? 'ready' : undefined;
void value;
`),
    },
    {
      name: 'return-object',
      source:
        withHeader(`const buildUser = (isEnabled: boolean): { readonly label: string } => isEnabled ? { label: 'on' } : { label: 'off' };
const result = buildUser(true);
void result;
`),
    },
    {
      name: 'return-array',
      source:
        withHeader(`const buildValues = (isEnabled: boolean): readonly string[] => isEnabled ? ['on'] : ['off'];
const result = buildValues(true);
void result;
`),
    },
    {
      name: 'variable-with-type-annotation-number',
      source: withHeader(`const isEnabled = true;
const count: number = isEnabled ? 1 : 2;
void count;
`),
    },
    {
      name: 'variable-with-type-annotation-boolean',
      source: withHeader(`const isEnabled = true;
const hasAccess: boolean = isEnabled ? true : false;
void hasAccess;
`),
    },
    {
      name: 'multi-declarator-preserved',
      source: withHeader(`const isEnabled = true;
const label = isEnabled ? 'on' : 'off';
const count = 1;
void label;
void count;
`),
    },
    {
      name: 'exported-variable-preserved',
      source: withInternalHeader(`${internalDeclarationDoc}export const label = 'on';
`),
    },
    {
      name: 'assignment-with-parenthesized-condition',
      source: withHeader(`const isEnabled = true;
let count = 1;
count = (isEnabled) ? 1 : 2;
void count;
`),
    },
    {
      name: 'typed-call-branch',
      source: withHeader(`const isEnabled = true;
const buildOnLabel = (): string => 'on';
const buildOffLabel = (): string => 'off';
const label: string = isEnabled ? buildOnLabel() : buildOffLabel();
void label;
`),
    },
    {
      name: 'branch-repair-number',
      source: withHeader(`const isEnabled = true;
let count;
if (isEnabled) {
  count = 1;
} else {
  count = 2;
}
void count;
`),
    },
    {
      name: 'branch-repair-boolean',
      source: withHeader(`const isEnabled = true;
let hasAccess;
if (isEnabled) {
  hasAccess = true;
} else {
  hasAccess = false;
}
void hasAccess;
`),
    },
    {
      name: 'branch-repair-typed',
      source: withHeader(`const isEnabled = true;
let label: string;
if (isEnabled) {
  label = 'on';
} else {
  label = 'off';
}
void label;
`),
    },
  ],
  'rename-acronyms': [
    {
      name: 'url-variable',
      source: withHeader(`const requestUrl = 'https://example.com';
void requestUrl;
`),
    },
    {
      name: 'id-variable',
      source: withHeader(`const userId = 'user-1';
void userId;
`),
    },
    {
      name: 'http-status',
      source: withHeader(`const httpStatusCode = 200;
void httpStatusCode;
`),
    },
    {
      name: 'css-selector',
      source: withHeader(`const cssSelector = '.root';
void cssSelector;
`),
    },
    {
      name: 'html-parser',
      source: withHeader(`const htmlParser = (value: string): string => value;
const result = htmlParser('ready');
void result;
`),
    },
    {
      name: 'sql-query',
      source: withHeader(`const sqlQuery = 'select 1';
void sqlQuery;
`),
    },
    {
      name: 'uuid-value',
      source: withHeader(`const uuidValue = '00000000-0000-0000-0000-000000000000';
void uuidValue;
`),
    },
    {
      name: 'json-object',
      source: withHeader(`const jsonObject = { value: 'ready' };
void jsonObject;
`),
    },
    {
      name: 'api-response-type',
      source: withHeader(`interface APIResponse {
  readonly status: number;
}

const response: APIResponse = { status: 200 };
void response;
`),
    },
    {
      name: 'member-acronym',
      source: withHeader(`class Parser {
  readonly jsonValue = 'ready';
}

void Parser;
`),
    },
    {
      name: 'destructuring-binding',
      source: withHeader(`const source = { jsonValue: 'ready' };
const { jsonValue } = source;
void jsonValue;
`),
    },
    {
      name: 'array-pattern-binding',
      source: withHeader(`const values = ['ready'];
const [jsonValue] = values;
void jsonValue;
`),
    },
    {
      name: 'exported-name-preserved',
      source:
        withInternalHeader(`${internalDeclarationDoc}export const parseJSON = (value: string): string => value;
`),
    },
    {
      name: 'imported-name-preserved',
      source: withImportHeader(`import { Array as EffectArray } from 'effect';

void EffectArray;
`),
    },
    {
      name: 'object-key-preserved',
      source: withHeader(`const value = {
  jsonValue: 'ready',
};

void value;
`),
    },
  ],
  'sort-imports': [
    {
      name: 'default-before-named',
      source: withImportHeader(`import jscodeshift from 'jscodeshift';
import { Array } from 'effect';

void Array;
void jscodeshift;
`),
    },
    {
      name: 'type-before-value',
      source: withImportHeader(`import { Array } from 'effect';
import type { ASTPath } from 'jscodeshift';

type Entry = ASTPath;
const entry = undefined as Entry | undefined;
void Array;
void entry;
`),
    },
    {
      name: 'default-with-named',
      source: withImportHeader(`import type { ASTPath } from 'jscodeshift';
import jscodeshift from 'jscodeshift';

type Entry = ASTPath;
const entry = undefined as Entry | undefined;
void entry;
void jscodeshift;
`),
    },
    {
      name: 'named-alias-sort',
      source:
        withImportHeader(`import { Option as EffectOption, Array as EffectArray } from 'effect';

void EffectArray;
void EffectOption;
`),
    },
    {
      name: 'multiple-sources',
      source: withImportHeader(`import { NodeRuntime } from '@effect/platform-node';
import { Array } from 'effect';
import type { ASTPath } from 'jscodeshift';

type Entry = ASTPath;
const entry = undefined as Entry | undefined;
void Array;
void entry;
void NodeRuntime;
`),
    },
    {
      name: 'side-effect-preserved',
      source: withImportHeader(`import { Array } from 'effect';

void Array;
`),
    },
    {
      name: 'already-sorted',
      source: withImportHeader(`import { Array, Option, pipe } from 'effect';

void Array;
void Option;
void pipe;
`),
    },
    {
      name: 'long-named-import',
      source: withImportHeader(`import {
  pipe,
  Predicate,
  Option,
  Order,
  Array,
} from 'effect';

void Array;
void Option;
void Order;
void Predicate;
void pipe;
`),
    },
    {
      name: 'type-only-named-sort',
      source: withImportHeader(`import type {
  Collection,
  ASTPath,
  Identifier,
} from 'jscodeshift';

type Entry = ASTPath | Collection | Identifier;
const entry = undefined as Entry | undefined;
void entry;
`),
    },
    {
      name: 'same-source-value-and-type',
      source: withImportHeader(`import type { ASTPath } from 'jscodeshift';
import jscodeshift from 'jscodeshift';

type Entry = ASTPath;
const entry = undefined as Entry | undefined;
void entry;
void jscodeshift;
`),
    },
    {
      name: 'effect-platform-order',
      source: withImportHeader(`import { NodeRuntime } from '@effect/platform-node';
import { Array } from 'effect';

void Array;
void NodeRuntime;
`),
    },
    {
      name: 'single-import-noop',
      source: withImportHeader(`import { Array } from 'effect';

void Array;
`),
    },
    {
      name: 'type-import-only-noop',
      source: withImportHeader(`import type { ASTPath } from 'jscodeshift';

type Entry = ASTPath;
const entry = undefined as Entry | undefined;
void entry;
`),
    },
    {
      name: 'default-import-only',
      source: withImportHeader(`import jscodeshift from 'jscodeshift';

void jscodeshift;
`),
    },
    {
      name: 'separated-imports',
      source: withImportHeader(`import { Array } from 'effect';

import type { ASTPath } from 'jscodeshift';

type Entry = ASTPath;
const entry = undefined as Entry | undefined;
void Array;
void entry;
`),
    },
  ],
} satisfies Record<string, readonly CodemodQualityCase[]>;

const broadEdgeCasesByCodemod = {
  'arrow-body-style': [
    {
      name: 'promise-return',
      source: withHeader(`const loadValue = (): Promise<string> => {
  return Promise.resolve('ready');
};

void loadValue();
`),
    },
    {
      name: 'readonly-object-return',
      source: withHeader(`const buildConfig = (): { readonly isEnabled: boolean } => {
  return { isEnabled: true };
};

const result = buildConfig();
void result;
`),
    },
    {
      name: 'object-as-const-return',
      source: withHeader(`const buildConfig = (): { readonly isEnabled: true } => {
  return { isEnabled: true } as const;
};

const result = buildConfig();
void result;
`),
    },
    {
      name: 'mapped-array-return',
      source: withHeader(`const trimValues = (values: readonly string[]): string[] => {
  return values.map((value): string => value.trim());
};

const result = trimValues([' ready ']);
void result;
`),
    },
    {
      name: 'satisfies-return-preserved',
      source: withHeader(`const buildConfig = (): { readonly isEnabled: boolean } => {
  return { isEnabled: true } satisfies { readonly isEnabled: boolean };
};

const result = buildConfig();
void result;
`),
    },
    {
      name: 'literal-union-return',
      source: withHeader(`const readyStatus = (): 'ready' => {
  return 'ready';
};

const result = readyStatus();
void result;
`),
    },
    {
      name: 'readonly-set-return',
      source: withHeader(`const buildSet = (value: string): ReadonlySet<string> => {
  return new Set([value]);
};

const result = buildSet('ready');
void result;
`),
    },
    {
      name: 'nested-object-return',
      source: withHeader(`const buildNested = (): { readonly child: { readonly name: string } } => {
  return { child: { name: 'Ada' } };
};

const result = buildNested();
void result;
`),
    },
    {
      name: 'parenthesized-string-return',
      source: withHeader(`const formatValue = (value: string): string => {
  return (value.trim());
};

const result = formatValue('ready');
void result;
`),
    },
    {
      name: 'try-finally-preserved',
      source: withHeader(`const formatValue = (value: string): string => {
  try {
    return value.trim();
  } finally {
    void value;
  }
};

const result = formatValue('ready');
void result;
`),
    },
    {
      name: 'do-nothing-block-preserved',
      source: withHeader(`const run = (): void => {
  sink('ready');
};

const sink = (value: string): void => {
  void value;
};

run();
`),
    },
    {
      name: 'default-parameter-return',
      source: withHeader(`const formatValue = (value = 'ready'): string => {
  return value.trim();
};

const result = formatValue();
void result;
`),
    },
    {
      name: 'rest-parameter-return',
      source: withHeader(`const joinValues = (...values: readonly string[]): string => {
  return values.join(':');
};

const result = joinValues('a', 'b');
void result;
`),
    },
    {
      name: 'destructured-parameter-return',
      source: withHeader(`const formatUser = (input: { readonly name: string }): string => {
  return input.name.trim();
};

const result = formatUser({ name: 'Ada' });
void result;
`),
    },
    {
      name: 'quoted-string-return',
      source: withHeader(`const formatValue = (value: string): string => {
  return \`\${value}:ready\`;
};

const result = formatValue('ready');
void result;
`),
    },
    {
      name: 'multi-line-expression-return',
      source: withHeader(`const isConfigured = (value: string): boolean => {
  return firstPredicate(value) &&
    secondPredicate(value) &&
    thirdPredicate(value);
};

const firstPredicate = (value: string): boolean => value.length > 0;
const secondPredicate = (value: string): boolean => value.length > 1;
const thirdPredicate = (value: string): boolean => value.length > 2;
const result = isConfigured('ready');
void result;
`),
    },
  ],
  'explicit-return-types': [
    {
      name: 'satisfies-expression-already-typed',
      source: withHeader(`const buildConfig = (): { readonly isEnabled: boolean } =>
  ({ isEnabled: true }) satisfies { readonly isEnabled: boolean };

const result = buildConfig();
void result;
`),
    },
    {
      name: 'as-const-already-typed',
      source: withHeader(`const buildValues = (): readonly ['ready'] => ['ready'] as const;

const result = buildValues();
void result;
`),
    },
    {
      name: 'higher-order-already-typed',
      source:
        withHeader(`const makeFormatter = (): ((value: string) => string) => (value: string): string => value.trim();

const formatter = makeFormatter();
const result = formatter('ready');
void result;
`),
    },
    {
      name: 'never-function-already-typed',
      source: withHeader(`const fail = (message: string): never => {
  throw new Error(message);
};

void fail;
`),
    },
    {
      name: 'class-method-already-typed',
      source: withHeader(`class Formatter {
  formatValue(value: string): string {
    return value.trim();
  }
}

void Formatter;
`),
    },
    {
      name: 'class-method-untyped',
      source: withHeader(`class Formatter {
  readonly label = 'ready';

  formatValue(value: string) {
    return value.trim();
  }
}

void Formatter;
`),
    },
    {
      name: 'private-class-method-untyped',
      source: withHeader(`class Formatter {
  #formatValue(value: string) {
    return value.trim();
  }

  run(value: string): string {
    return this.#formatValue(value);
  }
}

void Formatter;
`),
    },
    {
      name: 'static-method-already-typed',
      source: withHeader(`class Formatter {
  readonly label = 'ready';

  static formatValue(value: string): string {
    return value.trim();
  }
}

void Formatter;
`),
    },
    {
      name: 'generic-arrow-already-typed',
      source: withHeader(`const identity = <Value>(value: Value): Value => value;

const result = identity('ready');
void result;
`),
    },
    {
      name: 'callback-property-run',
      source: withHeader(`const task = {
  run: (): void => {
    sink('ready');
  },
};

const sink = (value: string): void => {
  void value;
};

task.run();
`),
    },
    {
      name: 'callback-property-create',
      source: withHeader(`const factory = {
  create: (value: string): string => value.trim(),
};

const result = factory.create('ready');
void result;
`),
    },
    {
      name: 'mixed-return-already-typed',
      source: withHeader(`const maybeValue = (isEnabled: boolean): string | undefined => {
  if (isEnabled) {
    return 'ready';
  }
  return undefined;
};

void maybeValue;
`),
    },
    {
      name: 'readonly-tuple-already-typed',
      source:
        withHeader(`const pairValues = (left: string, right: string): readonly [string, string] => [left, right];

const result = pairValues('left', 'right');
void result;
`),
    },
    {
      name: 'object-return-already-typed',
      source: withHeader(`const buildUser = (name: string): { readonly name: string } => ({ name });

const result = buildUser('Ada');
void result;
`),
    },
    {
      name: 'readonly-set-already-typed',
      source: withHeader(`const buildSet = (value: string): ReadonlySet<string> => new Set([value]);

const result = buildSet('ready');
void result;
`),
    },
    {
      name: 'async-string-already-typed',
      source: withHeader(`const loadValue = async (): Promise<string> => 'ready';

void loadValue();
`),
    },
    {
      name: 'crlf-expression',
      source: withHeader(
        'const formatValue = (value: string) => value.trim();\r\n\r\nconst result = formatValue("ready");\r\nvoid result;\r\n',
      ),
    },
  ],
  'format-file-header': [
    {
      name: 'crlf-jsdoc-header',
      source: `/** CRLF helper module. */\r\n${moduleScopePreamble}const value = 1;\r\nvoid value;\r\n`,
    },
    {
      name: 'shebang-jsdoc-import',
      source: `#!/usr/bin/env node
/** CLI import module. */
import { Array } from 'effect';

void Array;
`,
    },
    {
      name: 'module-augmentation-preserved',
      source: `/** Module augmentation helper. */
${moduleScopePreamble}declare module 'effect' {
  /**
   * Augments effect for codemod quality samples.
   */
  export interface CodemodQualityAugmentation {
    readonly value: string;
  }
}
`,
    },
    {
      name: 'ambient-declaration-preserved',
      source: `/** Ambient declaration helper. */
${moduleScopePreamble}declare const codemodQualityValue: string;
void codemodQualityValue;
`,
    },
    {
      name: 'namespace-declaration-preserved',
      source: `/** Namespace declaration helper. */
${moduleScopePreamble}namespace CodemodQualityNamespace {
  /**
   * Sample namespace value.
   */
  export const value = 'ready';
}

void CodemodQualityNamespace;
`,
    },
    {
      name: 'decorator-like-string-preserved',
      source: `/** Decorator marker helper. */
${moduleScopePreamble}const marker = '@sealed';
void marker;
`,
    },
    {
      name: 'export-default-and-named',
      source: `/** Mixed export helper. */
${moduleScopePreamble}${internalDeclarationDoc}export const value = 1;
const defaultValue = value;
export default defaultValue;
`,
    },
    {
      name: 'satisfies-declaration',
      source: `/** Satisfies helper module. */
${moduleScopePreamble}const config = { isEnabled: true } satisfies { readonly isEnabled: boolean };
void config;
`,
    },
    {
      name: 'very-short-header',
      source: `/** X. */
${moduleScopePreamble}const value = 1;
void value;
`,
    },
    {
      name: 'very-long-word-header',
      source: `/** Codemodqualitygatehelpersforvalidatinggeneratedoutputswithoutdependingoncommittedartifacts. */
${moduleScopePreamble}const value = 1;
void value;
`,
    },
    {
      name: 'header-after-leading-comment-preserved',
      source: `/** Leading purpose module. */
${moduleScopePreamble}const value = 1;
void value;
`,
    },
    {
      name: 'empty-lines-after-header',
      source: `/** Empty line helper module. */


${moduleScopePreamble}const value = 1;
void value;
`,
    },
    {
      name: 'import-then-declaration-jsdoc',
      source: `/** Import declaration helper. */
import { Array } from 'effect';

/**
 * Local value.
 */
const value = Array.empty<string>();
void value;
`,
    },
    {
      name: 'type-only-file',
      source: `/** Type only helper. */
${moduleScopePreamble}type Identifier = string;
const identifier: Identifier = 'ready';
void identifier;
`,
    },
    {
      name: 'enum-file-extra',
      source: `/** Enum helper module. */
${moduleScopePreamble}enum CodemodQualityStatus {
  Ready = 'ready',
}

void CodemodQualityStatus;
`,
    },
    {
      name: 'directive-after-header',
      source: `/** Directive helper module. */
'use strict';

${moduleScopePreamble}const value = 1;
void value;
`,
    },
  ],
  'format-jsdoc-comments': [
    {
      name: 'deprecated-tag',
      source: withHeader(`/** Old helper. @deprecated Use newHelper. */
const value = 1;
void value;
`),
    },
    {
      name: 'see-tag',
      source: withHeader(`/** Helper value. @see otherHelper */
const value = 1;
void value;
`),
    },
    {
      name: 'since-tag',
      source: withHeader(`/** Helper value. @since 1.0.0 */
const value = 1;
void value;
`),
    },
    {
      name: 'multiple-param-tags',
      source:
        withHeader(`/** Joins values. @param left - Left value. @param right - Right value. @returns Joined value. */
const joinValues = (left: string, right: string): string => \`\${left}:\${right}\`;
void joinValues;
`),
    },
    {
      name: 'throws-and-returns-tags',
      source: withHeader(`/** Requires a value. @returns The value. @throws When empty. */
const requireValue = (value: string): string => {
  if (value.length === 0) {
    throw new Error('value is required');
  }
  return value;
};

void requireValue;
`),
    },
    {
      name: 'quoted-comment-string',
      source: withHeader(`const marker = "before /** @internal sample. */ after";
void marker;
`),
    },
    {
      name: 'regex-containing-comment-markers',
      source: withHeader(`const pattern = /\\/\\*\\* @internal/u;
void pattern;
`),
    },
    {
      name: 'line-comment-with-jsdoc-marker',
      source: withHeader(`const marker = '/** value */';
void marker;
`),
    },
    {
      name: 'crlf-jsdoc',
      source: withHeader('/** CRLF helper. @internal */\r\nconst value = 1;\r\nvoid value;\r\n'),
    },
    {
      name: 'empty-summary-with-tag',
      source: withHeader(`/**
 * Sample helper.
 *
 * @internal
 */
const value = 1;
void value;
`),
    },
    {
      name: 'single-line-method-doc',
      source: withHeader(`const visitor = {
  /** Visits a value. */
  visit(value: string): void {
    void value;
  },
};

void visitor;
`),
    },
    {
      name: 'single-line-property-doc',
      source: withHeader(`const config = {
  /** Whether the config is enabled. */
  isEnabled: true,
};

void config;
`),
    },
    {
      name: 'summary-with-inline-code',
      source: withHeader(`/** Formats \`value\`. @returns Trimmed value. */
const formatValue = (value: string): string => value.trim();
void formatValue;
`),
    },
    {
      name: 'summary-with-url',
      source: withHeader(`/** Reads https://example.com metadata. @internal */
const value = 'ready';
void value;
`),
    },
    {
      name: 'multiple-jsdoc-blocks',
      source: withHeader(`/** First helper. @internal */
const firstValue = 1;
void firstValue;

/** Second helper. @internal */
const secondValue = 2;
void secondValue;
`),
    },
    {
      name: 'inline-link-tag',
      source: withHeader(`/** Formats {@link value}. @returns Trimmed value. */
const formatValue = (value: string): string => value.trim();
void formatValue;
`),
    },
  ],
  'function-declarations': [
    {
      name: 'recursive-function',
      source: withHeader(`function factorial(value: number): number {
  if (value <= 1) {
    return 1;
  }
  const result = value * factorial(value - 1);
  return result;
}

const inputValue = 'abc'.length;
const result = factorial(inputValue);
void result;
`),
    },
    {
      name: 'mutually-recursive-a',
      source: withHeader(`function isEven(value: number): boolean {
  if (value === 0) {
    return true;
  }
  return isOdd(value - 1);
}

const isOdd = (value: number): boolean => {
  if (value === 0) {
    return false;
  }
  return isEven(value - 1);
};

const result = isEven(2);
void result;
`),
    },
    {
      name: 'function-inside-if',
      source: withHeader(`const isEnabled = true;
if (isEnabled) {
  const prefix = 'value:';
  function formatValue(value: string): string {
    const formatted = prefix + value.trim();
    return formatted;
  }
  const result = formatValue('ready');
  void result;
}
`),
    },
    {
      name: 'function-inside-switch',
      source: withHeader(`const status = 'ready' as const;
switch (status) {
  case 'ready': {
    const prefix = 'status:';
    function formatValue(): string {
      const formatted = prefix + status.trim();
      return formatted;
    }
    const result = formatValue();
    void result;
    break;
  }
}
`),
    },
    {
      name: 'function-inside-loop',
      source: withHeader(`for (const value of ['ready']) {
  function formatValue(): string {
    const formatted = value.trim();
    return formatted;
  }
  const result = formatValue();
  void result;
}
`),
    },
    {
      name: 'async-generator-preserved',
      source:
        withHeader(`async function* streamValues(values: readonly string[]): AsyncGenerator<string> {
  for (const value of values) {
    yield value;
  }
}

void streamValues;
`),
    },
    {
      name: 'generator-preserved',
      source: withHeader(`function* streamValues(values: readonly string[]): Generator<string> {
  for (const value of values) {
    yield value;
  }
}

void streamValues;
`),
    },
    {
      name: 'export-default-named-preserved',
      source:
        withHeader(`${internalDeclarationDoc}export default function defaultFormatter(value: string): string {
  const formatted = value.trim();
  return formatted;
}
`),
    },
    {
      name: 'function-with-satisfies-body',
      source: withHeader(`function buildConfig(): { readonly isEnabled: boolean } {
  const config = { isEnabled: true } satisfies { readonly isEnabled: boolean };
  return config;
}

const result = buildConfig();
void result;
`),
    },
    {
      name: 'function-returning-arrow',
      source: withHeader(`function makeFormatter(): (value: string) => string {
  const prefix = 'value:';
  const formatter = (value: string): string => prefix + value.trim();
  return formatter;
}

const result = makeFormatter();
void result;
`),
    },
    {
      name: 'function-with-readonly-tuple',
      source:
        withHeader(`function pairValues(left: string, right: string): readonly [string, string] {
  const pair = [left, right] as const;
  return pair;
}

const result = pairValues('left', 'right');
void result;
`),
    },
    {
      name: 'function-with-object-return',
      source: withHeader(`function buildUser(name: string): { readonly name: string } {
  const user = { name };
  return user;
}

const result = buildUser('Ada');
void result;
`),
    },
    {
      name: 'exported-string-function',
      source:
        withInternalHeader(`${internalDeclarationDoc}export function loadValue(value: string): string {
  const formatted = value.trim();
  return formatted;
}
`),
    },
    {
      name: 'declare-function-preserved',
      source: withHeader(`declare function externalFormat(value: string): string;

void externalFormat;
`),
    },
    {
      name: 'overloaded-function-preserved',
      source: withHeader(`function normalizeValue(value: string): string;
function normalizeValue(value: readonly string[]): readonly string[];
function normalizeValue(value: string | readonly string[]): string | readonly string[] {
  if (typeof value === 'string') {
    return value.trim();
  }
  return value.map((entry): string => entry.trim());
}

const result = normalizeValue('ready');
void result;
`),
    },
    {
      name: 'namespace-function',
      source: withHeader(`namespace CodemodQualityNamespace {
  /**
   * Formats a namespace value.
   */
  export function formatValue(value: string): string {
    const formatted = value.trim();
    return formatted;
  }
}

void CodemodQualityNamespace;
`),
    },
  ],
  'inline-export-lists': [
    {
      name: 'comments-between-export-specifiers',
      source: withInternalHeader(`${internalDeclarationDoc}const alpha = 1;
${internalDeclarationDoc}const beta = 2;

export {
  alpha,
  beta,
};
`),
    },
    {
      name: 'declarations-separated-by-comments',
      source: withInternalHeader(`${internalDeclarationDoc}const alpha = 1;
${internalDeclarationDoc}const beta = 2;

export { alpha, beta };
`),
    },
    {
      name: 'enum-with-members',
      source: withInternalHeader(`${internalDeclarationDoc}enum Status {
  Ready = 'ready',
  Pending = 'pending',
}

export { Status };
`),
    },
    {
      name: 'class-with-method',
      source: withInternalHeader(`${internalDeclarationDoc}class Formatter {
  formatValue(value: string): string {
    return value.trim();
  }
}

export { Formatter };
`),
    },
    {
      name: 'interface-with-generic',
      source: withInternalHeader(`${internalDeclarationDoc}interface Box<Value> {
  readonly value: Value;
}

export type { Box };
`),
    },
    {
      name: 'type-with-satisfies-value',
      source: withInternalHeader(`${internalDeclarationDoc}interface Options {
  readonly isEnabled: boolean;
}
${internalDeclarationDoc}const options = { isEnabled: true } satisfies Options;

export type { Options };
export { options };
`),
    },
    {
      name: 'const-with-as-const',
      source:
        withInternalHeader(`${internalDeclarationDoc}const statuses = ['ready', 'pending'] as const;

export { statuses };
`),
    },
    {
      name: 'export-list-after-import',
      source: `${internalModuleHeader}import type { ASTPath as CodemodQualityModuleScope } from 'jscodeshift';

type CodemodQualitySentinel = CodemodQualityModuleScope;
const codemodQualitySentinel = undefined as CodemodQualitySentinel | undefined;
void codemodQualitySentinel;

${internalDeclarationDoc}const value = 1;

export { value };
`,
    },
    {
      name: 'export-type-and-value-same-name-preserved',
      source: withInternalHeader(`${internalDeclarationDoc}interface Value {
  readonly id: string;
}
${internalDeclarationDoc}const Value = {
  id: 'ready',
};

export { Value };
export type { Value };
`),
    },
    {
      name: 'export-list-with-semicolon',
      source: withInternalHeader(`${internalDeclarationDoc}const value = 1;

export { value };
`),
    },
    {
      name: 'export-list-without-extra-bindings',
      source: withInternalHeader(`${internalDeclarationDoc}const value = 1;

export {
  value,
};
`),
    },
    {
      name: 'export-before-declaration',
      source: withInternalHeader(`export { value };

${internalDeclarationDoc}const value = 1;
`),
    },
    {
      name: 'type-reexport-bare-preserved',
      source: withHeader(`export type { ASTPath } from 'jscodeshift';
`),
    },
    {
      name: 'value-reexport-bare-preserved',
      source: withHeader(`export { Array } from 'effect';
`),
    },
    {
      name: 'namespace-reexport-bare-preserved',
      source: withHeader(`export * from 'effect';
`),
    },
    {
      name: 'default-alias-preserved',
      source: withInternalHeader(`${internalDeclarationDoc}const value = 1;

export { value as default };
`),
    },
  ],
  'internal-export-docs': [
    {
      name: 'internal-header-uppercase',
      source: `/* -------------------------------------------------------------------------- */
/*              INTERNAL codemod generated quality gate sample.              */
/* -------------------------------------------------------------------------- */
${moduleScopePreamble}export const value = 1;
`,
    },
    {
      name: 'internal-header-mixed-case',
      source: `/* -------------------------------------------------------------------------- */
/*              Internal codemod generated quality gate sample.              */
/* -------------------------------------------------------------------------- */
${moduleScopePreamble}export const value = 1;
`,
    },
    {
      name: 'internal-header-after-shebang',
      source: `#!/usr/bin/env node
/* -------------------------------------------------------------------------- */
/*              Internal codemod generated quality gate sample.              */
/* -------------------------------------------------------------------------- */
${moduleScopePreamble}export const value = 1;
`,
    },
    {
      name: 'export-after-import',
      source: `${internalModuleHeader}import type { ASTPath as CodemodQualityModuleScope } from 'jscodeshift';

type CodemodQualitySentinel = CodemodQualityModuleScope;
const codemodQualitySentinel = undefined as CodemodQualitySentinel | undefined;
void codemodQualitySentinel;

export const value = 1;
`,
    },
    {
      name: 'decorator-like-string-export',
      source: withInternalHeader(`export const marker = '@internal';
`),
    },
    {
      name: 'satisfies-export',
      source:
        withInternalHeader(`export const config = { isEnabled: true } satisfies { readonly isEnabled: boolean };
`),
    },
    {
      name: 'as-const-export',
      source: withInternalHeader(`export const statuses = ['ready'] as const;
`),
    },
    {
      name: 'export-default-preserved',
      source: withInternalHeader(`${internalDeclarationDoc}const value = 1;
export default value;
`),
    },
    {
      name: 'export-default-undocumented',
      source: withInternalHeader(`const value = 1;
export default value;
`),
    },
    {
      name: 'namespace-export',
      source: withInternalHeader(`export namespace CodemodQualityNamespace {
  export const value = 'ready';
}
`),
    },
    {
      name: 'module-augmentation-internal-export',
      source: withInternalHeader(`declare module 'effect' {
  export interface CodemodQualityAugmentation {
    readonly value: string;
  }
}
`),
    },
    {
      name: 'declare-export',
      source: withInternalHeader(`export declare const externalValue: string;
`),
    },
    {
      name: 'module-augmentation-public-preserved',
      source: withHeader(`declare module 'effect' {
  /**
   * Augments effect for codemod quality samples.
   */
  export interface CodemodQualityAugmentation {
    readonly value: string;
  }
}
`),
    },
    {
      name: 'exported-readonly-tuple',
      source: withInternalHeader(`export const pair = ['left', 'right'] as const;
`),
    },
    {
      name: 'exported-function-type',
      source: withInternalHeader(`export type Formatter = (value: string) => string;
`),
    },
    {
      name: 'exported-interface-existing-non-jsdoc-comment',
      source: withInternalHeader(`/* Existing block comment. */
export interface Options {
  readonly isEnabled: boolean;
}
`),
    },
    {
      name: 'multiple-mixed-exports',
      source: withInternalHeader(`export interface Options {
  readonly isEnabled: boolean;
}
export const config = { isEnabled: true };
export type Status = 'ready';
`),
    },
  ],
  'no-ternary': [
    {
      name: 'return-with-parenthesized-condition',
      source: withHeader(`const label = (isEnabled: boolean): string => (isEnabled) ? 'on' : 'off';
const result = label(true);
void result;
`),
    },
    {
      name: 'assignment-object-property',
      source: withHeader(`const isEnabled = true;
const state = { label: '' };
state.label = isEnabled ? 'on' : 'off';
void state;
`),
    },
    {
      name: 'template-literal-ternary-preserved',
      source: withHeader(`const isEnabled = true;
const label = isEnabled ? 'on' : 'off';
const message = \`status:\${label}\`;
void message;
`),
    },
    {
      name: 'object-literal-ternary-value',
      source: withHeader(`const isEnabled = true;
const state: { readonly label: string } = isEnabled ? { label: 'on' } : { label: 'off' };
void state;
`),
    },
    {
      name: 'array-literal-ternary-value',
      source: withHeader(`const isEnabled = true;
const values: readonly string[] = isEnabled ? ['on'] : ['off'];
void values;
`),
    },
    {
      name: 'call-argument-ternary',
      source: withHeader(`const isEnabled = true;
const formatLabel = (label: string): string => label;
const label = isEnabled ? 'on' : 'off';
const result = formatLabel(label);
void result;
`),
    },
    {
      name: 'await-branch-return',
      source:
        withHeader(`const loadLabel = async (isEnabled: boolean): Promise<string> => isEnabled ? await loadOnLabel() : await loadOffLabel();
const loadOnLabel = async (): Promise<string> => 'on';
const loadOffLabel = async (): Promise<string> => 'off';
void loadLabel(true);
`),
    },
    {
      name: 'different-primitive-types-preserved',
      source: withHeader(`const isEnabled = true;
const value: string | number = isEnabled ? 'on' : 0;
void value;
`),
    },
    {
      name: 'partial-branch-assignment-preserved',
      source: withHeader(`const isEnabled = true;
let label = 'off';
if (isEnabled) {
  label = 'on';
}
void label;
`),
    },
    {
      name: 'comments-between-declaration-and-if',
      source: withHeader(`const isEnabled = true;
let label;

if (isEnabled) {
  label = 'on';
} else {
  label = 'off';
}
void label;
`),
    },
    {
      name: 'nested-return-preserved',
      source: withHeader(`const label = (isEnabled: boolean, isPending: boolean): string => {
  if (isEnabled) {
    return 'on';
  }
  if (isPending) {
    return 'pending';
  }
  return 'off';
};
const result = label(true, false);
void result;
`),
    },
    {
      name: 'return-with-object-branches',
      source:
        withHeader(`const buildState = (isEnabled: boolean): { readonly label: string } => isEnabled ? { label: 'on' } : { label: 'off' };
const result = buildState(true);
void result;
`),
    },
    {
      name: 'assignment-with-member-left',
      source: withHeader(`const isEnabled = true;
const state = { label: '' };
state.label = isEnabled ? 'on' : 'off';
void state;
`),
    },
    {
      name: 'branch-repair-with-comments',
      source: withHeader(`const isEnabled = true;
let label;
if (isEnabled) {
  label = 'on';
} else {
  label = 'off';
}
void label;
`),
    },
    {
      name: 'boolean-return-with-negation',
      source:
        withHeader(`const hasAccess = (isDisabled: boolean): boolean => isDisabled ? false : true;
const result = hasAccess(false);
void result;
`),
    },
    {
      name: 'as-const-branches',
      source: withHeader(`const isEnabled = true;
const status = isEnabled ? ('ready' as const) : ('pending' as const);
void status;
`),
    },
  ],
  'rename-acronyms': [
    {
      name: 'multiple-acronyms',
      source: withHeader(`const parseJsonUrl = (value: string): URL => new URL(value);
const result = parseJsonUrl('https://example.com');
void result;
`),
    },
    {
      name: 'acronym-with-number',
      source: withHeader(`const http2Status = 200;
void http2Status;
`),
    },
    {
      name: 'sha256-hash',
      source: withHeader(`const sha256Hash = 'abc';
void sha256Hash;
`),
    },
    {
      name: 'enum-member-acronym',
      source: withHeader(`enum StatusCode {
  HttpOk = 'ok',
}

void StatusCode;
`),
    },
    {
      name: 'interface-name-acronym',
      source: withHeader(`interface ApiClientConfig {
  readonly baseUrl: string;
}

const config: ApiClientConfig = { baseUrl: 'https://example.com' };
void config;
`),
    },
    {
      name: 'class-private-field',
      source: withHeader(`class Parser {
  readonly jsonValue = 'ready';
}

void Parser;
`),
    },
    {
      name: 'object-shorthand-property',
      source: withHeader(`const jsonValue = 'ready';
const value = { jsonValue };
void value;
`),
    },
    {
      name: 'destructuring-alias',
      source: withHeader(`const source = { jsonValue: 'ready' };
const { jsonValue: localValue } = source;
void localValue;
`),
    },
    {
      name: 'case-collision-preserved',
      source: withHeader(`const parseJSON = (value: string): string => value;
const result = parseJSON('ready');
void result;
`),
    },
    {
      name: 'string-comment-preserved',
      source: withHeader(`const label = 'parseJson';
void label;
`),
    },
    {
      name: 'method-reference',
      source: withHeader(`const parser = {
  parseUrl(value: string): URL {
    return new URL(value);
  },
};
const parse = (value: string): URL => parser.parseUrl(value);
const result = parse('https://example.com');
void result;
`),
    },
    {
      name: 'type-reference',
      source: withHeader(`interface ApiResponse {
  readonly status: number;
}
const response: ApiResponse = { status: 200 };
void response;
`),
    },
    {
      name: 'property-access-chain',
      source: withHeader(`const parser = {
  apiClient: {
    baseUrl: 'https://example.com',
  },
};
const result = parser.apiClient.baseUrl;
void result;
`),
    },
    {
      name: 'optional-member-call',
      source: withHeader(`const parser = {
  parseJson(value: string): string {
    return value.trim();
  },
};
const result = parser.parseJson?.('ready');
void result;
`),
    },
    {
      name: 'import-source-path-preserved',
      source: withImportHeader(`import { Array as EffectArray } from 'effect';

void EffectArray;
`),
    },
    {
      name: 'export-specifier-preserved',
      source:
        withInternalHeader(`${internalDeclarationDoc}const parseJSON = (value: string): string => value;
export { parseJSON };
`),
    },
  ],
  'sort-imports': [
    {
      name: 'comments-between-imports',
      source: withImportHeader(`import { NodeRuntime } from '@effect/platform-node';
import { Array } from 'effect';

void Array;
void NodeRuntime;
`),
    },
    {
      name: 'specifier-comments-adjacent',
      source: withImportHeader(`import {
  Option,
  Array,
} from 'effect';

void Array;
void Option;
`),
    },
    {
      name: 'import-attributes-like-string',
      source: withImportHeader(`import { Array } from 'effect';

const marker = 'with { type: "json" }';
void Array;
void marker;
`),
    },
    {
      name: 'single-named-import-preserved',
      source: withImportHeader(`import { Array } from 'effect';

void Array;
`),
    },
    {
      name: 'duplicate-source-merged-input',
      source: withImportHeader(`import { Array, Option } from 'effect';

void Array;
void Option;
`),
    },
    {
      name: 'side-effect-boundary',
      source: withImportHeader(`import { Array } from 'effect';

void Array;
`),
    },
    {
      name: 'non-import-boundary',
      source: withImportHeader(`import { Array } from 'effect';

const value = 1;
void Array;
void value;
`),
    },
    {
      name: 'source-path-order',
      source: withImportHeader(`import type { ASTPath } from 'jscodeshift';
import { NodeRuntime } from '@effect/platform-node';
import { Array } from 'effect';

type Entry = ASTPath;
const entry = undefined as Entry | undefined;
void Array;
void entry;
void NodeRuntime;
`),
    },
    {
      name: 'default-and-type-separate',
      source: withImportHeader(`import type { ASTPath } from 'jscodeshift';
import jscodeshift from 'jscodeshift';

type Entry = ASTPath;
const entry = undefined as Entry | undefined;
void entry;
void jscodeshift;
`),
    },
    {
      name: 'long-import-threshold',
      source:
        withImportHeader(`import { Array, Boolean, Equal, Number, Option, Order, Predicate, String, pipe } from 'effect';

void Array;
void Boolean;
void Equal;
void Number;
void Option;
void Order;
void Predicate;
void String;
void pipe;
`),
    },
    {
      name: 'single-type-specifier',
      source: withImportHeader(`import type { ASTPath } from 'jscodeshift';

type Entry = ASTPath;
const entry = undefined as Entry | undefined;
void entry;
`),
    },
    {
      name: 'single-value-specifier',
      source: withImportHeader(`import { Array } from 'effect';

void Array;
`),
    },
    {
      name: 'aliased-type-import',
      source: withImportHeader(`import type { ASTPath as JSCodeshiftPath } from 'jscodeshift';

type Entry = JSCodeshiftPath;
const entry = undefined as Entry | undefined;
void entry;
`),
    },
    {
      name: 'aliased-value-import',
      source: withImportHeader(`import { Array as EffectArray } from 'effect';

void EffectArray;
`),
    },
    {
      name: 'crlf-imports',
      source: withImportHeader(
        'import { Option, Array } from "effect";\r\n\r\nvoid Array;\r\nvoid Option;\r\n',
      ),
    },
  ],
} satisfies Record<string, readonly CodemodQualityCase[]>;

const qualityCodemods = codemods.map(
  (codemod): CodemodQualitySubject => ({
    ...codemod,
    cases: [
      ...codemod.cases,
      ...(extraCasesByCodemod[codemod.name] ?? []),
      ...(broadEdgeCasesByCodemod[codemod.name] ?? []),
    ],
  }),
);

const recreateOutputRoot = (): void => {
  if (existsSync(outputRoot)) {
    rmSync(outputRoot, { force: true, recursive: true });
  }
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(
    join(outputRoot, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          noEmit: true,
        },
        exclude: ['tsconfig.json'],
        extends: '../../tsconfig.base.json',
        include: ['**/*.ts'],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const nativeConfig = theThracianOxlint({ typeAware: true });
  writeFileSync(
    outputOxlintConfig,
    `${JSON.stringify(
      {
        categories: nativeConfig.categories,
        options: nativeConfig.options,
        plugins: nativeConfig.plugins,
        rules: nativeConfig.rules,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
};

const writeTransformedOutputs = (): void => {
  recreateOutputRoot();

  for (const codemod of qualityCodemods) {
    const codemodOutput = join(outputRoot, codemod.name);
    mkdirSync(codemodOutput, { recursive: true });

    for (const testCase of codemod.cases) {
      writeFileSync(
        join(codemodOutput, `${testCase.name}.ts`),
        codemod.transform(testCase.source),
        'utf8',
      );
    }
  }
};

describe('codemod quality gate', (): void => {
  it.each(qualityCodemods)('$name has broad edge-case quality samples', (codemod): void => {
    expect(codemod.cases.length).toBeGreaterThanOrEqual(minimumCasesPerCodemod);
  });

  it('produces repository-lint-clean TypeScript for every codemod sample', (): void => {
    writeTransformedOutputs();

    const result = spawnSync(
      'pnpm',
      [
        'exec',
        'oxlint',
        '-c',
        outputOxlintConfig,
        outputRoot,
        '--tsconfig',
        join(outputRoot, 'tsconfig.json'),
        '--type-aware',
        '--type-check',
      ],
      { encoding: 'utf8', env: subprocessEnv() },
    );

    expect(result.status, result.stdout + result.stderr).toBe(0);
  }, 30_000);
});
