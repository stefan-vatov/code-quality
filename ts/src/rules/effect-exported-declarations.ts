/* -------------------------------------------------------------------------- */
/*       Exported declaration extraction helpers for Effect lint rules.       */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';
import {
  createModuleSourceIndex,
  findModuleStatementEnd,
  moduleBindingDeclarations,
  moduleLevelMatches,
} from './effect-module-source-index';
import {
  exportedCallableDeclarationSegment,
  exportedDeclarationSegment,
} from './effect-export-segments';
import type { ModuleBindingDeclaration } from './effect-module-source-index';
import { declarationWithBraceBody } from './effect-export-declaration-boundaries';
import { defaultExportBindingName } from './effect-export-default-binding';
import { stripCommentsAndStrings } from './effect-source-scan';

type ModuleSourceIndex = ReturnType<typeof createModuleSourceIndex>;
interface ExportedDeclarationProjection {
  readonly analysisText: string;
  readonly declarationText: string;
}

const EXPORTED_DECLARATION_CACHE_MAX = 256;
const exportedDeclarationCache = new Map<string, string[]>();
const exportedDeclarationSegmentCache = new Map<string, string[]>();
const exportedCallableDeclarationSegmentCache = new Map<string, string[]>();
const exportedDeclarationProjectionCache = new Map<
  string,
  readonly ExportedDeclarationProjection[]
>();
const cachedExportedDeclarations = (source: string): string[] | undefined =>
  exportedDeclarationCache.get(source);

const cacheValue = <Value>(cache: Map<string, Value>, source: string, value: Value): Value => {
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

const cacheExportedDeclarationProjections = (
  source: string,
  projections: readonly ExportedDeclarationProjection[],
): readonly ExportedDeclarationProjection[] =>
  cacheValue(exportedDeclarationProjectionCache, source, projections);

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

const isBraceBodyDeclaration = (declarationText: string): boolean =>
  /\b(?:async\s+)?function\b|\b(?:abstract\s+)?class\b|\binterface\b/.test(declarationText);

const namedExportDeclarationText = (
  source: string,
  code: string,
  declaration: ModuleBindingDeclaration,
): string | undefined =>
  pipe(
    Match.value(isBraceBodyDeclaration(declaration.match[0])),
    Match.when(true, (): string | undefined =>
      declarationWithBraceBody(source, code, declaration.statementStart, declaration.match[0]),
    ),
    Match.orElse((): string =>
      source.slice(declaration.statementStart, declaration.statementEnd + 1),
    ),
  );

const isolatedVariableDeclarationText = (
  source: string,
  declaration: ModuleBindingDeclaration,
): string => {
  const semicolonCode = 59;
  const prefix = source.slice(declaration.statementStart, declaration.variableKeywordEnd);
  const declarator = source.slice(declaration.declaratorStart, declaration.declaratorEnd);
  if (source.charCodeAt(declaration.statementEnd) === semicolonCode) {
    return `${prefix} ${declarator};`;
  }
  return `${prefix} ${declarator}`;
};

const privateSiblingText = (
  source: string,
  statementStart: number,
  statementEnd: number,
  selectedDeclarations: readonly ModuleBindingDeclaration[],
): string => {
  let text = '';
  let sourceIndex = statementStart;
  for (const declaration of selectedDeclarations) {
    text += source.slice(sourceIndex, declaration.declaratorStart);
    sourceIndex = declaration.declaratorEnd;
  }
  return text + source.slice(sourceIndex, statementEnd + 1);
};

const shouldIsolateVariableDeclaration = (
  source: string,
  declaration: ModuleBindingDeclaration,
  selectedDeclarations: readonly ModuleBindingDeclaration[],
): boolean =>
  declaration.siblingCount > selectedDeclarations.length &&
  /\b(?:Effect|Promise)\b/.test(
    privateSiblingText(
      source,
      declaration.statementStart,
      declaration.statementEnd,
      selectedDeclarations,
    ),
  );

const variableProjection = (
  source: string,
  declaration: ModuleBindingDeclaration,
  selectedDeclarations: readonly ModuleBindingDeclaration[],
): ExportedDeclarationProjection => {
  const analysisText = isolatedVariableDeclarationText(source, declaration);
  if (shouldIsolateVariableDeclaration(source, declaration, selectedDeclarations)) {
    return { analysisText, declarationText: analysisText };
  }
  const declarationText = source.slice(declaration.statementStart, declaration.statementEnd + 1);
  return { analysisText, declarationText };
};

const bindingProjection = (
  source: string,
  code: string,
  declaration: ModuleBindingDeclaration,
  selectedDeclarations: readonly ModuleBindingDeclaration[],
): ExportedDeclarationProjection | undefined => {
  if (declaration.kind === 'variable') {
    return variableProjection(source, declaration, selectedDeclarations);
  }
  const declarationText = namedExportDeclarationText(source, code, declaration);
  if (declarationText === undefined) {
    return undefined;
  }
  return { analysisText: declarationText, declarationText };
};

const addNamedExportDeclarations = (
  source: string,
  code: string,
  declarations: ReadonlyMap<string, readonly ModuleBindingDeclaration[]>,
  exportedList: string,
): readonly ExportedDeclarationProjection[] => {
  const selectedDeclarations = pipe(
    exportedNamesFromList(exportedList),
    Array.flatMap((exportedName) => declarations.get(exportedName) ?? []),
  );
  const declarationsByStatement = new Map<number, ModuleBindingDeclaration[]>();
  for (const declaration of selectedDeclarations) {
    const statementDeclarations = declarationsByStatement.get(declaration.statementStart);
    if (statementDeclarations === undefined) {
      declarationsByStatement.set(declaration.statementStart, [declaration]);
    } else {
      statementDeclarations.push(declaration);
    }
  }
  return pipe(
    selectedDeclarations,
    Array.filterMap(
      (declaration): Option.Option<ExportedDeclarationProjection> =>
        Option.fromNullable(
          bindingProjection(
            source,
            code,
            declaration,
            declarationsByStatement.get(declaration.statementStart) ?? [],
          ),
        ),
    ),
  );
};

const addStatementDeclarations = (
  source: string,
  code: string,
  matches: Iterable<RegExpMatchArray>,
): string[] =>
  pipe(
    Array.fromIterable(matches),
    Array.filterMap(
      (match): Option.Option<string> =>
        pipe(
          Option.fromNullable(match.index),
          Option.map((index): string => {
            const statementEnd = findModuleStatementEnd(source, code, index);
            return source.slice(index, statementEnd + 1);
          }),
        ),
    ),
  );

const addBraceDeclarations = (
  source: string,
  code: string,
  matches: Iterable<RegExpMatchArray>,
): string[] =>
  pipe(
    Array.fromIterable(matches),
    Array.filterMap(
      (match): Option.Option<string> =>
        pipe(
          Option.fromNullable(match.index),
          Option.flatMap((index) =>
            Option.fromNullable(declarationWithBraceBody(source, code, index, match[0])),
          ),
        ),
    ),
  );

const addDirectExportDeclarations = (
  source: string,
  code: string,
  moduleIndex: ModuleSourceIndex,
): string[] =>
  pipe(
    [
      addStatementDeclarations(
        source,
        code,
        moduleLevelMatches(
          moduleIndex,
          /\bexport\s+default\s+(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>/g,
        ),
      ),
      addBraceDeclarations(
        source,
        code,
        moduleLevelMatches(
          moduleIndex,
          /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\b/g,
        ),
      ),
      addStatementDeclarations(
        source,
        code,
        moduleLevelMatches(
          moduleIndex,
          /\bexport\s+(?:declare\s+)?(?:const|let|var)\s+(?:[A-Za-z_$][\w$]*|[{[])/g,
        ),
      ),
      addStatementDeclarations(
        source,
        code,
        moduleLevelMatches(moduleIndex, /\bexport\s+type\s+[A-Za-z_$][\w$]*\b/g),
      ),
      addBraceDeclarations(
        source,
        code,
        moduleLevelMatches(moduleIndex, /\bexport\s+interface\s+[A-Za-z_$][\w$]*\b/g),
      ),
      addBraceDeclarations(
        source,
        code,
        moduleLevelMatches(
          moduleIndex,
          /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?class(?:\s+[A-Za-z_$][\w$]*)?\b/g,
        ),
      ),
      addStatementDeclarations(
        source,
        code,
        moduleLevelMatches(
          moduleIndex,
          /\bexport\s+default\s+(?!(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>|(?:abstract\s+)?class\b|(?:async\s+)?function\b)/g,
        ),
      ),
    ],
    Array.flatten,
  );

const addNamedExportLists = (
  source: string,
  code: string,
  moduleIndex: ModuleSourceIndex,
): readonly ExportedDeclarationProjection[] => {
  const exportLists = moduleLevelMatches(moduleIndex, /\bexport\s+(?:type\s+)?{\s*([^}]+)\s*}/g);
  if (Array.isEmptyReadonlyArray(exportLists)) {
    return [];
  }
  const declarations = moduleBindingDeclarations(moduleIndex);
  return pipe(
    exportLists,
    Array.flatMap((exportMatch): readonly ExportedDeclarationProjection[] => {
      const exportStatementEnd = findModuleStatementEnd(code, code, exportMatch.index);
      const exportStatement = code.slice(exportMatch.index, exportStatementEnd + 1);
      return Match.value(/\bfrom\s*['"]/.test(exportStatement)).pipe(
        Match.when(true, (): readonly ExportedDeclarationProjection[] => []),
        Match.orElse((): readonly ExportedDeclarationProjection[] =>
          addNamedExportDeclarations(source, code, declarations, exportMatch[1]),
        ),
      );
    }),
  );
};

const addDefaultIdentifierExports = (
  source: string,
  code: string,
  moduleIndex: ModuleSourceIndex,
): readonly ExportedDeclarationProjection[] => {
  const declarations = moduleBindingDeclarations(moduleIndex);
  return pipe(
    moduleLevelMatches(moduleIndex, /\bexport\s+default\b/g),
    Array.flatMap((exportMatch): readonly ExportedDeclarationProjection[] => {
      const statementEnd = findModuleStatementEnd(source, code, exportMatch.index);
      const expressionStart = exportMatch.index + exportMatch[0].length;
      const bindingName = defaultExportBindingName(code.slice(expressionStart, statementEnd + 1));
      if (bindingName === undefined) {
        return [];
      }
      const bindingDeclarations = declarations.get(bindingName) ?? [];
      return pipe(
        bindingDeclarations,
        Array.filterMap(
          (declaration): Option.Option<ExportedDeclarationProjection> =>
            Option.fromNullable(bindingProjection(source, code, declaration, [declaration])),
        ),
      );
    }),
  );
};

const isTransparentDefaultBindingDeclaration = (declaration: string): boolean => {
  if (!/^\s*export\s+default\b/.test(declaration)) {
    return false;
  }
  const expression = declaration.replace(/^\s*export\s+default\s+/, '');
  return defaultExportBindingName(stripCommentsAndStrings(expression)) !== undefined;
};

const uniqueProjections = (
  projections: readonly ExportedDeclarationProjection[],
): readonly ExportedDeclarationProjection[] => {
  const keys = new Set<string>();
  return pipe(
    projections,
    Array.filter((projection): boolean => {
      const key = `${projection.declarationText}\u0000${projection.analysisText}`;
      if (keys.has(key)) {
        return false;
      }
      keys.add(key);
      return true;
    }),
  );
};

const exportedDeclarationProjections = (
  source: string,
): readonly ExportedDeclarationProjection[] => {
  const cachedValue = exportedDeclarationProjectionCache.get(source);
  if (cachedValue !== undefined) {
    return cachedValue;
  }
  if (!source.includes('export')) {
    return cacheExportedDeclarationProjections(source, []);
  }
  const code = stripCommentsAndStrings(source);
  const moduleIndex = createModuleSourceIndex(code);
  const directProjections = pipe(
    addDirectExportDeclarations(source, code, moduleIndex),
    Array.filter((declaration): boolean => !isTransparentDefaultBindingDeclaration(declaration)),
    Array.map(
      (declaration): ExportedDeclarationProjection => ({
        analysisText: declaration,
        declarationText: declaration,
      }),
    ),
  );
  return cacheExportedDeclarationProjections(
    source,
    uniqueProjections([
      ...directProjections,
      ...addDefaultIdentifierExports(source, code, moduleIndex),
      ...addNamedExportLists(source, code, moduleIndex),
    ]),
  );
};

/** @internal */
export const exportedDeclarationTexts = (source: string): string[] => {
  const cachedValue = cachedExportedDeclarations(source);
  return pipe(
    Option.fromNullable(cachedValue),
    Option.match({
      onNone: (): string[] =>
        cacheExportedDeclarations(
          source,
          Array.fromIterable(
            new Set(
              pipe(
                exportedDeclarationProjections(source),
                Array.map((projection): string => projection.declarationText),
              ),
            ),
          ),
        ),
      onSome: (value): string[] => value,
    }),
  );
};

/** @internal */
export const exportedDeclarationSegments = (source: string): string[] => {
  const cachedValue = exportedDeclarationSegmentCache.get(source);
  return pipe(
    Option.fromNullable(cachedValue),
    Option.match({
      onNone: (): string[] =>
        cacheExportedDeclarationSegments(
          source,
          pipe(
            exportedDeclarationProjections(source),
            Array.map((projection): string => exportedDeclarationSegment(projection.analysisText)),
          ),
        ),
      onSome: (value): string[] => value,
    }),
  );
};

/** @internal */
export const exportedCallableDeclarationSegments = (source: string): string[] => {
  const cachedValue = exportedCallableDeclarationSegmentCache.get(source);
  return pipe(
    Option.fromNullable(cachedValue),
    Option.match({
      onNone: (): string[] =>
        cacheExportedCallableDeclarationSegments(
          source,
          pipe(
            exportedDeclarationProjections(source),
            Array.flatMap((projection): string[] =>
              exportedCallableDeclarationSegment(projection.analysisText),
            ),
          ),
        ),
      onSome: (value): string[] => value,
    }),
  );
};
