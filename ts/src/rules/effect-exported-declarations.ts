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
  declarationsGroupedByStatement,
  privateEffectsByStatement,
  privateSiblingHasEffect,
} from './effect-exported-declaration-projection';
import {
  exportedCallableDeclarationSegment,
  exportedDeclarationSegment,
} from './effect-export-segments';
import type { ModuleBindingDeclaration } from './effect-module-source-index';
import { createWeightedCache } from './source-cache';
import { declarationWithBraceBody } from './effect-export-declaration-boundaries';
import { defaultExportBindingName } from './effect-export-default-binding';
import { exportedSourceCode } from './effect-export-source-code';

type ModuleSourceIndex = ReturnType<typeof createModuleSourceIndex>;
interface ExportedDeclarationProjection {
  readonly analysisText: string;
  readonly declarationText: string;
}
interface WeightedSourceCache<Value> {
  readonly get: (source: string) => Value | undefined;
  readonly set: (source: string, value: Value, explicitWeight?: number) => Value;
}
type WeightedProjectionCache = WeightedSourceCache<readonly ExportedDeclarationProjection[]>;

const UTF16_BYTES_PER_CODE_UNIT = 2;
const STRING_CONTAINER_BYTES = 128;
const ARRAY_CONTAINER_BYTES = 128;
const OBJECT_CONTAINER_BYTES = 256;
const REFERENCE_BYTES = 8;

const exportedDeclarationCache: WeightedSourceCache<string[]> = createWeightedCache({
  maxEntries: 256,
  maxWeight: 5_767_168,
});
const exportedDeclarationSegmentCache: WeightedSourceCache<string[]> = createWeightedCache({
  maxEntries: 256,
  maxWeight: 5_767_168,
});
const exportedCallableDeclarationSegmentCache: WeightedSourceCache<string[]> = createWeightedCache({
  maxEntries: 256,
  maxWeight: 5_767_168,
});
const exportedDeclarationProjectionCache: WeightedProjectionCache = createWeightedCache({
  maxEntries: 256,
  maxWeight: 5_767_168,
});

const stringWeight = (value: string): number =>
  value.length * UTF16_BYTES_PER_CODE_UNIT + STRING_CONTAINER_BYTES;

const stringArrayWeight = (source: string, values: readonly string[]): number =>
  stringWeight(source) +
  ARRAY_CONTAINER_BYTES +
  values.length * REFERENCE_BYTES +
  values.reduce((weight, value): number => weight + stringWeight(value), 0);

const projectionWeight = (
  source: string,
  projections: readonly ExportedDeclarationProjection[],
): number =>
  stringWeight(source) +
  ARRAY_CONTAINER_BYTES +
  projections.length * REFERENCE_BYTES +
  projections.reduce(
    (weight, { analysisText, declarationText }): number =>
      weight +
      OBJECT_CONTAINER_BYTES +
      REFERENCE_BYTES * 2 +
      stringWeight(analysisText) +
      stringWeight(declarationText),
    0,
  );

const cachedExportedDeclarations = (source: string): string[] | undefined =>
  exportedDeclarationCache.get(source);

const cacheExportedDeclarations = (source: string, declarations: string[]): string[] =>
  exportedDeclarationCache.set(source, declarations, stringArrayWeight(source, declarations));

const cacheExportedDeclarationSegments = (source: string, segments: string[]): string[] =>
  exportedDeclarationSegmentCache.set(source, segments, stringArrayWeight(source, segments));

const cacheExportedCallableDeclarationSegments = (source: string, segments: string[]): string[] =>
  exportedCallableDeclarationSegmentCache.set(
    source,
    segments,
    stringArrayWeight(source, segments),
  );

const cacheExportedDeclarationProjections = (
  source: string,
  projections: readonly ExportedDeclarationProjection[],
): readonly ExportedDeclarationProjection[] =>
  exportedDeclarationProjectionCache.set(
    source,
    projections,
    projectionWeight(source, projections),
  );

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

const shouldIsolateVariableDeclaration = (
  declaration: ModuleBindingDeclaration,
  selectedDeclarations: readonly ModuleBindingDeclaration[],
  hasPrivateEffect: boolean,
): boolean => declaration.siblingCount > selectedDeclarations.length && hasPrivateEffect;

const variableProjection = (
  source: string,
  declaration: ModuleBindingDeclaration,
  selectedDeclarations: readonly ModuleBindingDeclaration[],
  hasPrivateEffect: boolean,
): ExportedDeclarationProjection => {
  const analysisText = isolatedVariableDeclarationText(source, declaration);
  if (shouldIsolateVariableDeclaration(declaration, selectedDeclarations, hasPrivateEffect)) {
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
  hasPrivateEffect: boolean,
): ExportedDeclarationProjection | undefined => {
  if (declaration.kind === 'variable') {
    return variableProjection(source, declaration, selectedDeclarations, hasPrivateEffect);
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
  const declarationsByStatement = declarationsGroupedByStatement(selectedDeclarations);
  const privateEffectByStatement = privateEffectsByStatement(source, declarationsByStatement);
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
            privateEffectByStatement.get(declaration.statementStart) ?? false,
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
            Option.fromNullable(
              bindingProjection(
                source,
                code,
                declaration,
                [declaration],
                privateSiblingHasEffect(
                  source,
                  declaration.statementStart,
                  declaration.statementEnd,
                  [declaration],
                ),
              ),
            ),
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
  return defaultExportBindingName(exportedSourceCode(expression)) !== undefined;
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
  const code = exportedSourceCode(source);
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
