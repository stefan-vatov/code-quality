/* -------------------------------------------------------------------------- */
/*       Exported declaration extraction helpers for Effect lint rules.       */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';
import { findMatchingBrace, stripCommentsAndStrings } from './effect-source-scan';
import { findStatementEnd } from './effect-source-navigation';

const EXPORTED_DECLARATION_CACHE_MAX = 256;
const exportedDeclarationCache = new Map<string, string[]>();
const exportedDeclarationSegmentCache = new Map<string, string[]>();
const exportedCallableDeclarationSegmentCache = new Map<string, string[]>();

const cachedExportedDeclarations = (source: string): string[] | undefined =>
  exportedDeclarationCache.get(source);

const cacheValue = (cache: Map<string, string[]>, source: string, value: string[]): string[] => {
  pipe(
    Match.value(cache.size),
    Match.when(
      (size): boolean => size >= EXPORTED_DECLARATION_CACHE_MAX,
      (): void => {
        pipe(
          Option.fromNullable(cache.keys().next().value),
          Option.match({
            onNone: (): void => undefined,
            onSome: (firstKey): void => {
              cache.delete(firstKey);
            },
          }),
        );
      },
    ),
    Match.orElse((): void => undefined),
  );
  cache.set(source, value);
  return value;
};

const cacheExportedDeclarations = (source: string, declarations: string[]): string[] =>
  cacheValue(exportedDeclarationCache, source, declarations);

const cacheExportedDeclarationSegments = (source: string, segments: string[]): string[] =>
  cacheValue(exportedDeclarationSegmentCache, source, segments);

const cacheExportedCallableDeclarationSegments = (source: string, segments: string[]): string[] =>
  cacheValue(exportedCallableDeclarationSegmentCache, source, segments);

const declarationWithBraceBody = (source: string, startIndex: number): string | undefined => {
  const bodyStart = source.indexOf('{', startIndex);
  return Match.value(bodyStart).pipe(
    Match.when(-1, (): undefined => undefined),
    Match.orElse((start): string | undefined => {
      const bodyEnd = findMatchingBrace(source, start);
      return Match.value(bodyEnd).pipe(
        Match.when(-1, (): undefined => undefined),
        Match.orElse((end): string => source.slice(startIndex, end + 1)),
      );
    }),
  );
};

const exportedNamesFromList = (exportedList: string): string[] =>
  pipe(
    exportedList.split(','),
    Array.filterMap((name): Option.Option<string> => {
      const exportedName = name
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim();
      return pipe(
        Option.fromNullable(exportedName),
        Option.filter((value): boolean => value.length > 0),
      );
    }),
  );

const namedExportDeclarationPattern = (exportedName: string): RegExp =>
  new RegExp(
    `\\b(?:(?:const|let|var)\\s+${exportedName}\\b|` +
      `(?:async\\s+)?function\\s+${exportedName}\\b|` +
      `type\\s+${exportedName}\\b|interface\\s+${exportedName}\\b|` +
      `(?:abstract\\s+)?class\\s+${exportedName}\\b)`,
  );

const isBraceBodyDeclaration = (declarationText: string): boolean =>
  /\b(?:async\s+)?function\b|\b(?:abstract\s+)?class\b|\binterface\b/.test(declarationText);

const namedExportDeclarationText = (
  source: string,
  code: string,
  exportedName: string,
): string | undefined => {
  const declarationMatch = namedExportDeclarationPattern(exportedName).exec(code);
  return pipe(
    Option.fromNullable(declarationMatch),
    Option.match({
      onNone: (): undefined => undefined,
      onSome: (match): string | undefined =>
        Match.value(isBraceBodyDeclaration(match[0])).pipe(
          Match.when(true, (): string | undefined => declarationWithBraceBody(source, match.index)),
          Match.orElse((): string => {
            const statementEnd = findStatementEnd(source, match.index);
            return source.slice(match.index, statementEnd + 1);
          }),
        ),
    }),
  );
};

const addNamedExportDeclarations = (source: string, code: string, exportedList: string): string[] =>
  pipe(
    exportedNamesFromList(exportedList),
    Array.filterMap(
      (exportedName): Option.Option<string> =>
        Option.fromNullable(namedExportDeclarationText(source, code, exportedName)),
    ),
  );

const addStatementDeclarations = (source: string, matches: Iterable<RegExpMatchArray>): string[] =>
  pipe(
    Array.fromIterable(matches),
    Array.filterMap(
      (match): Option.Option<string> =>
        pipe(
          Option.fromNullable(match.index),
          Option.map((index): string => {
            const statementEnd = findStatementEnd(source, index);
            return source.slice(index, statementEnd + 1);
          }),
        ),
    ),
  );

const addBraceDeclarations = (source: string, matches: Iterable<RegExpMatchArray>): string[] =>
  pipe(
    Array.fromIterable(matches),
    Array.filterMap(
      (match): Option.Option<string> =>
        pipe(
          Option.fromNullable(match.index),
          Option.flatMap((index) => Option.fromNullable(declarationWithBraceBody(source, index))),
        ),
    ),
  );

const addDirectExportDeclarations = (source: string, code: string): string[] =>
  pipe(
    [
      addStatementDeclarations(
        source,
        code.matchAll(/\bexport\s+default\s+(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>/g),
      ),
      addBraceDeclarations(
        source,
        code.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\b/g),
      ),
      addStatementDeclarations(
        source,
        code.matchAll(/\bexport\s+(?:const|let|var)\s+[A-Za-z_$][\w$]*\b/g),
      ),
      addStatementDeclarations(source, code.matchAll(/\bexport\s+type\s+[A-Za-z_$][\w$]*\b/g)),
      addBraceDeclarations(source, code.matchAll(/\bexport\s+interface\s+[A-Za-z_$][\w$]*\b/g)),
      addBraceDeclarations(
        source,
        code.matchAll(/\bexport\s+(?:default\s+)?(?:abstract\s+)?class(?:\s+[A-Za-z_$][\w$]*)?\b/g),
      ),
      addStatementDeclarations(
        source,
        code.matchAll(/\bexport\s+default\s+(?!class\b|(?:async\s+)?function\b)/g),
      ),
    ],
    Array.flatten,
  );

const addNamedExportLists = (source: string, code: string): string[] =>
  pipe(
    Array.fromIterable(code.matchAll(/\bexport\s+(?:type\s+)?{\s*([^}]+)\s*}/g)),
    Array.flatMap((exportMatch): string[] => {
      const exportStatementEnd = findStatementEnd(code, exportMatch.index);
      const exportStatement = code.slice(exportMatch.index, exportStatementEnd + 1);
      return Match.value(/\bfrom\s*['"]/.test(exportStatement)).pipe(
        Match.when(true, (): string[] => []),
        Match.orElse((): string[] => addNamedExportDeclarations(source, code, exportMatch[1])),
      );
    }),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const exportedDeclarationTexts = (source: string): string[] => {
  const cachedValue = cachedExportedDeclarations(source);
  return pipe(
    Option.fromNullable(cachedValue),
    Option.match({
      onNone: (): string[] => {
        const code = stripCommentsAndStrings(source);
        return cacheExportedDeclarations(
          source,
          pipe(
            [addDirectExportDeclarations(source, code), addNamedExportLists(source, code)],
            Array.flatten,
          ),
        );
      },
      onSome: (value): string[] => value,
    }),
  );
};

const findAssignmentEquals = (declaration: string): number =>
  pipe(
    Array.range(0, declaration.length - 1),
    Array.findFirst((index): boolean => {
      const char = declaration[index];
      const previousChar = declaration[index - 1];
      const nextChar = declaration[index + 1];
      return (
        char === '=' &&
        previousChar !== '=' &&
        previousChar !== '!' &&
        previousChar !== '<' &&
        previousChar !== '>' &&
        nextChar !== '=' &&
        nextChar !== '>'
      );
    }),
    Option.getOrElse((): number => -1),
  );

const arrowValueSegment = (value: string): string => {
  const arrowIndex = value.indexOf('=>');
  return Match.value(/^\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(value)).pipe(
    Match.when(true, (): string => value.slice(arrowIndex + 2)),
    Match.orElse((): string => value),
  );
};

const declarationInitializerValue = (declaration: string): string => {
  const equalsIndex = findAssignmentEquals(declaration);
  return Match.value(equalsIndex).pipe(
    Match.when(-1, (): string => declaration),
    Match.orElse((index): string => declaration.slice(index + 1)),
  );
};

const exportedDeclarationSegment = (declaration: string): string =>
  Match.value(declaration).pipe(
    Match.when(
      (value): boolean => /^\s*export\s+default\b/.test(value),
      (value): string => arrowValueSegment(value.replace(/^\s*export\s+default\s+/, '')),
    ),
    Match.when(
      (value): boolean => /^\s*(?:export\s+)?(?:const|let|var)\b/.test(value),
      (value): string => arrowValueSegment(declarationInitializerValue(value)),
    ),
    Match.orElse((value): string =>
      Match.value(value.indexOf('{')).pipe(
        Match.when(-1, (): string => value),
        Match.orElse((bodyStart): string => value.slice(bodyStart)),
      ),
    ),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const exportedDeclarationSegments = (source: string): string[] => {
  const cachedValue = exportedDeclarationSegmentCache.get(source);
  return pipe(
    Option.fromNullable(cachedValue),
    Option.match({
      onNone: (): string[] =>
        cacheExportedDeclarationSegments(
          source,
          pipe(exportedDeclarationTexts(source), Array.map(exportedDeclarationSegment)),
        ),
      onSome: (value): string[] => value,
    }),
  );
};

const callableFunctionSegment = (declaration: string): string[] => {
  const bodyStart = declaration.indexOf('{');
  return Match.value(bodyStart).pipe(
    Match.when(-1, (): string[] => []),
    Match.orElse((start): string[] => [declaration.slice(start)]),
  );
};

const callableDefaultSegment = (declaration: string): string[] => {
  const value = declaration.replace(/^\s*export\s+default\s+/, '');
  return Match.value(/^\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(value)).pipe(
    Match.when(true, (): string[] => [value.slice(value.indexOf('=>') + 2)]),
    Match.orElse((): string[] => []),
  );
};

const callableVariableSegment = (declaration: string): string[] => {
  const value = declarationInitializerValue(declaration);
  return Match.value(/^\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(value)).pipe(
    Match.when(true, (): string[] => [value.slice(value.indexOf('=>') + 2)]),
    Match.orElse((): string[] => []),
  );
};

const exportedCallableDeclarationSegment = (declaration: string): string[] =>
  Match.value(declaration).pipe(
    Match.when(
      (value): boolean => /^\s*(?:export\s+)?(?:async\s+)?function\b/.test(value),
      callableFunctionSegment,
    ),
    Match.when((value): boolean => /^\s*export\s+default\b/.test(value), callableDefaultSegment),
    Match.when(
      (value): boolean => /^\s*(?:export\s+)?(?:const|let|var)\b/.test(value),
      callableVariableSegment,
    ),
    Match.orElse((): string[] => []),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const exportedCallableDeclarationSegments = (source: string): string[] => {
  const cachedValue = exportedCallableDeclarationSegmentCache.get(source);
  return pipe(
    Option.fromNullable(cachedValue),
    Option.match({
      onNone: (): string[] =>
        cacheExportedCallableDeclarationSegments(
          source,
          pipe(exportedDeclarationTexts(source), Array.flatMap(exportedCallableDeclarationSegment)),
        ),
      onSome: (value): string[] => value,
    }),
  );
};
