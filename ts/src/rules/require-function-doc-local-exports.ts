/* -------------------------------------------------------------------------- */
/*     Local export-list documentation helpers for exported JSDoc checks.     */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';

const CHAR_CODE_OPEN_BRACE = 123;
const CHAR_CODE_LOWER_A = 97;
const CHAR_CODE_LOWER_Z = 122;
const CHAR_CODE_UPPER_A = 65;
const CHAR_CODE_UPPER_Z = 90;
const TYPE_KEYWORD_LENGTH = 'type '.length;

const skipWhitespace = (source: string, pos: number): number =>
  Match.value(pos).pipe(
    Match.when(
      (cursor): boolean => cursor < source.length && /\s/u.test(source[cursor] ?? ''),
      (cursor): number => skipWhitespace(source, cursor + 1),
    ),
    Match.orElse((cursor): number => cursor),
  );

const exportStatementEnd = (source: string, afterExport: number): number => {
  const semicolon = source.indexOf(';', afterExport);
  return Match.value(semicolon).pipe(
    Match.when(
      (index): boolean => index === -1,
      (): number => source.indexOf('\n', afterExport),
    ),
    Match.orElse((index): number => index),
  );
};

const hasFromClauseBefore = (source: string, openBrace: number, statementEnd: number): boolean => {
  const end = Match.value(statementEnd).pipe(
    Match.when(
      (index): boolean => index === -1,
      (): number => source.length,
    ),
    Match.orElse((index): number => index),
  );
  return source.slice(openBrace, end).includes(' from ');
};

const localExportOpenBrace = (source: string, afterExport: number): number =>
  Match.value(afterExport).pipe(
    Match.when(
      (index): boolean =>
        source.slice(index, index + TYPE_KEYWORD_LENGTH) === 'type ' &&
        index + TYPE_KEYWORD_LENGTH < source.length,
      (index): number => skipWhitespace(source, index + TYPE_KEYWORD_LENGTH),
    ),
    Match.orElse((index): number => index),
  );

const localExportListBounds = (
  source: string,
  afterExport: number,
): { closeBrace: number; openBrace: number } | undefined => {
  const openBrace = localExportOpenBrace(source, afterExport);
  return Match.value(openBrace).pipe(
    Match.when(
      (index): boolean => source.charCodeAt(index) !== CHAR_CODE_OPEN_BRACE,
      (): undefined => undefined,
    ),
    Match.orElse((index): { closeBrace: number; openBrace: number } | undefined =>
      pipe(
        Match.value(source.indexOf('}', index)).pipe(
          Match.when(
            (closeBrace): boolean => closeBrace === -1,
            (): Option.Option<number> => Option.none(),
          ),
          Match.orElse((closeBrace): Option.Option<number> => Option.some(closeBrace)),
        ),
        Option.filter(
          (closeBrace): boolean =>
            !hasFromClauseBefore(source, index, exportStatementEnd(source, closeBrace)),
        ),
        Option.map((closeBrace): { closeBrace: number; openBrace: number } => ({
          closeBrace,
          openBrace: index,
        })),
        Option.getOrUndefined,
      ),
    ),
  );
};

const localExportName = (part: string): string =>
  part
    .trim()
    .replace(/^type\s+/u, '')
    .split(/\s+as\s+/u)[0]
    ?.trim() ?? '';

const localExportNames = (source: string, afterExport: number): readonly string[] | undefined => {
  const bounds = localExportListBounds(source, afterExport);
  return pipe(
    Option.fromNullable(bounds),
    Option.map((listBounds): readonly string[] =>
      pipe(
        source.slice(listBounds.openBrace + 1, listBounds.closeBrace).split(','),
        Array.map(localExportName),
        Array.filter((name): boolean => Boolean(name)),
      ),
    ),
    Option.getOrUndefined,
  );
};

const declarationNeedles = (name: string): readonly string[] => [
  `const ${name}`,
  `let ${name}`,
  `var ${name}`,
  `function ${name}`,
  `class ${name}`,
  `interface ${name}`,
  `type ${name}`,
  `enum ${name}`,
];

const isIdentifierBoundaryAfter = (source: string, pos: number): boolean => {
  if (pos >= source.length) {
    return true;
  }
  const code = source.charCodeAt(pos);
  return !(
    (code >= CHAR_CODE_LOWER_A && code <= CHAR_CODE_LOWER_Z) ||
    (code >= CHAR_CODE_UPPER_A && code <= CHAR_CODE_UPPER_Z)
  );
};

const localDeclarationPosition = (
  source: string,
  name: string,
  exportPOS: number,
): number | undefined => {
  const bestPosition = pipe(
    declarationNeedles(name),
    Array.reduce(-1, (currentBest, needle): number => {
      const pos = source.lastIndexOf(needle, exportPOS);
      return Match.value(pos).pipe(
        Match.when(
          (position): boolean =>
            position > currentBest && isIdentifierBoundaryAfter(source, position + needle.length),
          (position): number => position,
        ),
        Match.orElse((): number => currentBest),
      );
    }),
  );
  return pipe(
    Option.some(bestPosition),
    Option.filter((position): boolean => position !== -1),
    Option.getOrUndefined,
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const isDocumentedLocalExportList = (
  source: string,
  afterExport: number,
  exportPOS: number,
  hasJSDocBefore: (source: string, declarationPOS: number) => boolean,
): boolean | undefined => {
  const names = localExportNames(source, afterExport);
  return pipe(
    Option.fromNullable(names),
    Option.map((exportNames): boolean =>
      pipe(
        exportNames,
        Array.every((name): boolean =>
          pipe(
            Option.fromNullable(localDeclarationPosition(source, name, exportPOS)),
            Option.exists((declarationPOS): boolean => hasJSDocBefore(source, declarationPOS)),
          ),
        ),
      ),
    ),
    Option.getOrUndefined,
  );
};
