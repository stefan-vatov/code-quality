import { describe, expect, it } from 'vitest';
import hasRequiredFunctionDocs, {
  type RequiredFunctionDocFailure,
  findRequiredFunctionDocFailure,
} from '../../src/rules/require-function-doc';
import { isDocumentedLocalExportList } from '../../src/rules/require-function-doc-local-exports';
import { isInsideIgnoredText } from '../../src/rules/require-function-doc-ignored-text';

interface FailureCase {
  expected: RequiredFunctionDocFailure | undefined;
  source: string;
}

interface LocalExportResult {
  result: boolean | undefined;
  visitedDeclarationPositions: readonly number[];
}

const localExportResult = (
  source: string,
  documentedDeclarationNeedles: readonly string[],
): LocalExportResult => {
  const exportPosition = source.lastIndexOf('export ');
  const documentedDeclarationPositions = documentedDeclarationNeedles.map((needle) =>
    source.indexOf(needle),
  );
  const visitedDeclarationPositions: number[] = [];
  const result = isDocumentedLocalExportList(
    source,
    exportPosition + 'export '.length,
    exportPosition,
    (_input, declarationPosition): boolean => {
      visitedDeclarationPositions.push(declarationPosition);
      return documentedDeclarationPositions.includes(declarationPosition);
    },
  );

  return { result, visitedDeclarationPositions };
};

describe('findRequiredFunctionDocFailure mutation contracts', (): void => {
  it.each<FailureCase>([
    {
      source:
        '#!/usr/bin/env node\r\n/* bootstrap */\r\n// load command\r\n\r\nexport function cli() {}\r\n',
      expected: { line: 5, snippet: 'export function cli() {}' },
    },
    {
      source:
        '/** Public value. */\r\nexport const value = 1;\r\n\r\nexport async function run() {}',
      expected: { line: 4, snippet: 'export async function run() {}' },
    },
    {
      source:
        '/** Public value. */\nexport const value = 1;\ntype Missing = string;\nexport type { Missing };',
      expected: { line: 4, snippet: 'export type { Missing };' },
    },
    {
      source:
        'const generated = "prefix \\"export function fake() {}\\"";\r\nexport function real() {}',
      expected: { line: 2, snippet: 'export function real() {}' },
    },
  ])('reports exact CRLF and EOF locations for %#', ({ source, expected }): void => {
    expect(findRequiredFunctionDocFailure(source)).toEqual(expected);
    expect(hasRequiredFunctionDocs(source)).toEqual(false);
  });

  it.each<FailureCase>([
    {
      source:
        '#!/usr/bin/env node\r\n/* generated */\r\n// ambient API\r\ndeclare namespace API {\r\n  export function run(): void;\r\n}',
      expected: undefined,
    },
    {
      source: '/* generated */\n\ndeclare module "virtual" {\n  export const value: string;\n}',
      expected: undefined,
    },
    {
      source: '\tdeclare global {\n  export function collect(): void;\n}',
      expected: undefined,
    },
    {
      source: 'declare export function parse(input: string): string;',
      expected: undefined,
    },
  ])('skips exact ambient declaration forms for %#', ({ source, expected }): void => {
    expect(findRequiredFunctionDocFailure(source)).toEqual(expected);
    expect(hasRequiredFunctionDocs(source)).toEqual(true);
  });

  it.each<FailureCase>([
    {
      source: 'export default function main() {}',
      expected: { line: 1, snippet: 'export default function main() {}' },
    },
    {
      source: 'export async function load() {}',
      expected: { line: 1, snippet: 'export async function load() {}' },
    },
    {
      source: 'export default async function boot() {}',
      expected: { line: 1, snippet: 'export default async function boot() {}' },
    },
    {
      source: 'export abstract class Service {}',
      expected: { line: 1, snippet: 'export abstract class Service {}' },
    },
    {
      source: 'export default abstract class Entity {}',
      expected: { line: 1, snippet: 'export default abstract class Entity {}' },
    },
    {
      source: 'type Model = { readonly id: string };\nexport type { Model };',
      expected: { line: 2, snippet: 'export type { Model };' },
    },
  ])('preserves modifier semantics for %#', ({ source, expected }): void => {
    expect(findRequiredFunctionDocFailure(source)).toEqual(expected);
    expect(hasRequiredFunctionDocs(source)).toEqual(false);
  });

  it.each<FailureCase>([
    { source: 'export default 42;', expected: undefined },
    { source: 'export default configuration;', expected: undefined },
    { source: "export type { Model } from './model';", expected: undefined },
  ])('skips exact non-declaration export forms for %#', ({ source, expected }): void => {
    expect(findRequiredFunctionDocFailure(source)).toEqual(expected);
    expect(hasRequiredFunctionDocs(source)).toEqual(true);
  });
});

describe('isDocumentedLocalExportList mutation contracts', (): void => {
  it('resolves an aliased local export without accepting an identifier prefix', (): void => {
    const source =
      'const alphaExtra = 0;\n/** Alpha. */\nconst alpha = 1;\nexport { alpha as publicAlpha };';

    expect(localExportResult(source, ['const alpha ='])).toEqual({
      result: true,
      visitedDeclarationPositions: [source.indexOf('const alpha =')],
    });
  });

  it('resolves a type-only local export to its documented declaration', (): void => {
    const source =
      '/** Configuration. */\ntype Config = { readonly port: number };\nexport type { Config };';

    expect(localExportResult(source, ['type Config'])).toEqual({
      result: true,
      visitedDeclarationPositions: [source.indexOf('type Config')],
    });
  });

  it('checks every documented entry in a mixed aliased export list', (): void => {
    const source =
      '/** Alpha. */\nconst alpha = 1;\n/** Beta. */\ntype Beta = string;\nexport { alpha as publicAlpha, type Beta };';

    expect(localExportResult(source, ['const alpha', 'type Beta'])).toEqual({
      result: true,
      visitedDeclarationPositions: [source.indexOf('const alpha'), source.indexOf('type Beta')],
    });
  });

  it('returns false at the first undocumented entry in a mixed list', (): void => {
    const source =
      '/** Alpha. */\nconst alpha = 1;\ntype Beta = string;\nexport { alpha as publicAlpha, type Beta };';

    expect(localExportResult(source, ['const alpha'])).toEqual({
      result: false,
      visitedDeclarationPositions: [source.indexOf('const alpha'), source.indexOf('type Beta')],
    });
  });

  it('returns false without invoking the predicate for a missing declaration', (): void => {
    const source = 'const present = 1;\nexport { absent };';

    expect(localExportResult(source, ['const present'])).toEqual({
      result: false,
      visitedDeclarationPositions: [],
    });
  });

  it.each([
    "const local = 1;\nexport { remote } from './remote';",
    "type Local = string;\nexport type { Remote } from './remote';",
    "const local = 1;\nexport {\n  remote as publicRemote,\n} from './remote'",
  ])('returns undefined for a re-export from another module: %#', (source): void => {
    expect(localExportResult(source, ['const local', 'type Local'])).toEqual({
      result: undefined,
      visitedDeclarationPositions: [],
    });
  });
});

describe('isInsideIgnoredText mutation contracts', (): void => {
  it('preserves exact line-comment boundaries', (): void => {
    const source = 'const value = 1; // export fake\nexport const real = 1;';
    const commentStart = source.indexOf('//');
    const fakeExport = source.indexOf('export fake');
    const newline = source.indexOf('\n');

    expect(
      [0, commentStart, commentStart + 1, fakeExport, newline, newline + 1, source.length].map(
        (position): boolean => isInsideIgnoredText(source, position),
      ),
    ).toEqual([false, false, true, true, true, false, false]);
  });

  it('preserves exact block-comment boundaries', (): void => {
    const source = 'const value = /* export fake */ 1;';
    const commentStart = source.indexOf('/*');
    const fakeExport = source.indexOf('export fake');
    const commentClose = source.indexOf('*/');

    expect(
      [
        0,
        commentStart,
        commentStart + 1,
        fakeExport,
        commentClose,
        commentClose + 1,
        commentClose + 2,
        source.length,
      ].map((position): boolean => isInsideIgnoredText(source, position)),
    ).toEqual([false, false, true, true, true, false, false, false]);
  });

  it('preserves exact template-literal boundaries', (): void => {
    const source = 'const text = `export fake`; export const real = 1;';
    const templateOpen = source.indexOf('`');
    const fakeExport = source.indexOf('export fake');
    const templateClose = source.lastIndexOf('`');
    const realExport = source.indexOf('export const real');

    expect(
      [
        0,
        templateOpen,
        templateOpen + 1,
        fakeExport,
        templateClose,
        templateClose + 1,
        realExport,
      ].map((position): boolean => isInsideIgnoredText(source, position)),
    ).toEqual([false, false, true, true, true, false, false]);
  });

  it('keeps escaped quotes inside a string without hiding the real export', (): void => {
    const source =
      'const text = "before \\"export function fake() {}\\" after"; export function real() {}';
    const openingQuote = source.indexOf('"');
    const escapedQuote = source.indexOf('\\"') + 1;
    const fakeExport = source.indexOf('export function fake');
    const closingQuote = source.lastIndexOf('"');
    const realExport = source.indexOf('export function real');

    expect(
      [0, openingQuote, openingQuote + 1, escapedQuote, fakeExport, closingQuote, realExport].map(
        (position): boolean => isInsideIgnoredText(source, position),
      ),
    ).toEqual([false, false, true, true, true, true, false]);
  });

  it('defines exact offset-zero and end-of-source states', (): void => {
    const sources = ['', 'const value = 1;', '// comment at EOF', '/* closed */', '`closed`'];

    expect(sources.map((source): boolean => isInsideIgnoredText(source, 0))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(sources.map((source): boolean => isInsideIgnoredText(source, source.length))).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
  });
});
