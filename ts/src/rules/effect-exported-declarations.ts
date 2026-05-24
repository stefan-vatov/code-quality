/* -------------------------------------------------------------------------- */
/*       Exported declaration extraction helpers for Effect lint rules.       */
/* -------------------------------------------------------------------------- */
import { findMatchingBrace, stripCommentsAndStrings } from './effect-source-scan';
import { findStatementEnd } from './effect-source-navigation';

const EXPORTED_DECLARATION_CACHE_MAX = 256;
const exportedDeclarationCache = new Map<string, string[]>();
const exportedDeclarationSegmentCache = new Map<string, string[]>();
const exportedCallableDeclarationSegmentCache = new Map<string, string[]>();

const cachedExportedDeclarations = (source: string): string[] | undefined =>
  exportedDeclarationCache.get(source);

const cacheExportedDeclarations = (source: string, declarations: string[]): string[] => {
  if (exportedDeclarationCache.size >= EXPORTED_DECLARATION_CACHE_MAX) {
    const firstKey = exportedDeclarationCache.keys().next().value;
    if (firstKey !== undefined) {
      exportedDeclarationCache.delete(firstKey);
    }
  }
  exportedDeclarationCache.set(source, declarations);
  return declarations;
};

const cacheExportedDeclarationSegments = (source: string, segments: string[]): string[] => {
  if (exportedDeclarationSegmentCache.size >= EXPORTED_DECLARATION_CACHE_MAX) {
    const firstKey = exportedDeclarationSegmentCache.keys().next().value;
    if (firstKey !== undefined) {
      exportedDeclarationSegmentCache.delete(firstKey);
    }
  }
  exportedDeclarationSegmentCache.set(source, segments);
  return segments;
};

const cacheExportedCallableDeclarationSegments = (source: string, segments: string[]): string[] => {
  if (exportedCallableDeclarationSegmentCache.size >= EXPORTED_DECLARATION_CACHE_MAX) {
    const firstKey = exportedCallableDeclarationSegmentCache.keys().next().value;
    if (firstKey !== undefined) {
      exportedCallableDeclarationSegmentCache.delete(firstKey);
    }
  }
  exportedCallableDeclarationSegmentCache.set(source, segments);
  return segments;
};

const declarationWithBraceBody = (source: string, startIndex: number): string | undefined => {
  const bodyStart = source.indexOf('{', startIndex);
  if (bodyStart === -1) {
    return undefined;
  }

  const bodyEnd = findMatchingBrace(source, bodyStart);
  if (bodyEnd === -1) {
    return undefined;
  }

  return source.slice(startIndex, bodyEnd + 1);
};

const exportedNamesFromList = (exportedList: string): string[] =>
  exportedList
    .split(',')
    .map((name) =>
      name
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim(),
    )
    .filter(Boolean);

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
  if (!declarationMatch) {
    return undefined;
  }

  if (isBraceBodyDeclaration(declarationMatch[0])) {
    return declarationWithBraceBody(source, declarationMatch.index);
  }

  const statementEnd = findStatementEnd(source, declarationMatch.index);
  return source.slice(declarationMatch.index, statementEnd + 1);
};

const addNamedExportDeclarations = (
  source: string,
  code: string,
  exportedList: string,
  declarations: string[],
): void => {
  for (const exportedName of exportedNamesFromList(exportedList)) {
    const declaration = namedExportDeclarationText(source, code, exportedName);
    if (declaration) {
      declarations.push(declaration);
    }
  }
};

const addStatementDeclarations = (
  source: string,
  matches: Iterable<RegExpMatchArray>,
  declarations: string[],
): void => {
  for (const match of matches) {
    if (match.index !== undefined) {
      const statementEnd = findStatementEnd(source, match.index);
      declarations.push(source.slice(match.index, statementEnd + 1));
    }
  }
};

const addBraceDeclarations = (
  source: string,
  matches: Iterable<RegExpMatchArray>,
  declarations: string[],
): void => {
  for (const match of matches) {
    if (match.index !== undefined) {
      const declaration = declarationWithBraceBody(source, match.index);
      if (declaration) {
        declarations.push(declaration);
      }
    }
  }
};

const addDirectExportDeclarations = (
  source: string,
  code: string,
  declarations: string[],
): void => {
  addStatementDeclarations(
    source,
    code.matchAll(/\bexport\s+default\s+(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>/g),
    declarations,
  );
  addBraceDeclarations(
    source,
    code.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\b/g),
    declarations,
  );
  addStatementDeclarations(
    source,
    code.matchAll(/\bexport\s+(?:const|let|var)\s+[A-Za-z_$][\w$]*\b/g),
    declarations,
  );
  addStatementDeclarations(
    source,
    code.matchAll(/\bexport\s+type\s+[A-Za-z_$][\w$]*\b/g),
    declarations,
  );
  addBraceDeclarations(
    source,
    code.matchAll(/\bexport\s+interface\s+[A-Za-z_$][\w$]*\b/g),
    declarations,
  );
  addBraceDeclarations(
    source,
    code.matchAll(/\bexport\s+(?:default\s+)?(?:abstract\s+)?class(?:\s+[A-Za-z_$][\w$]*)?\b/g),
    declarations,
  );
  addStatementDeclarations(
    source,
    code.matchAll(/\bexport\s+default\s+(?!class\b|(?:async\s+)?function\b)/g),
    declarations,
  );
};

const addNamedExportLists = (source: string, code: string, declarations: string[]): void => {
  for (const exportMatch of code.matchAll(/\bexport\s+(?:type\s+)?{\s*([^}]+)\s*}/g)) {
    const exportStatementEnd = findStatementEnd(code, exportMatch.index);
    const exportStatement = code.slice(exportMatch.index, exportStatementEnd + 1);
    if (!/\bfrom\s*['"]/.test(exportStatement)) {
      addNamedExportDeclarations(source, code, exportMatch[1], declarations);
    }
  }
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const exportedDeclarationTexts = (source: string): string[] => {
  const cachedValue = cachedExportedDeclarations(source);
  if (cachedValue) {
    return cachedValue;
  }

  const code = stripCommentsAndStrings(source);
  const declarations: string[] = [];

  addDirectExportDeclarations(source, code, declarations);
  addNamedExportLists(source, code, declarations);

  return cacheExportedDeclarations(source, declarations);
};

const findAssignmentEquals = (declaration: string): number => {
  for (let index = 0; index < declaration.length; index++) {
    const char = declaration[index];
    const previousChar = declaration[index - 1];
    const nextChar = declaration[index + 1];
    if (
      char === '=' &&
      previousChar !== '=' &&
      previousChar !== '!' &&
      previousChar !== '<' &&
      previousChar !== '>' &&
      nextChar !== '=' &&
      nextChar !== '>'
    ) {
      return index;
    }
  }

  return -1;
};

const arrowValueSegment = (value: string): string => {
  const arrowIndex = value.indexOf('=>');
  if (/^\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(value)) {
    return value.slice(arrowIndex + 2);
  }
  return value;
};

const declarationInitializerValue = (declaration: string): string => {
  const equalsIndex = findAssignmentEquals(declaration);
  if (equalsIndex !== -1) {
    return declaration.slice(equalsIndex + 1);
  }
  return declaration;
};

const exportedDeclarationSegment = (declaration: string): string => {
  if (/^\s*export\s+default\b/.test(declaration)) {
    return arrowValueSegment(declaration.replace(/^\s*export\s+default\s+/, ''));
  }
  if (/^\s*(?:export\s+)?(?:const|let|var)\b/.test(declaration)) {
    return arrowValueSegment(declarationInitializerValue(declaration));
  }

  const bodyStart = declaration.indexOf('{');
  if (bodyStart === -1) {
    return declaration;
  }
  return declaration.slice(bodyStart);
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const exportedDeclarationSegments = (source: string): string[] => {
  const cachedValue = exportedDeclarationSegmentCache.get(source);
  if (cachedValue) {
    return cachedValue;
  }

  return cacheExportedDeclarationSegments(
    source,
    exportedDeclarationTexts(source).map(exportedDeclarationSegment),
  );
};

const callableFunctionSegment = (declaration: string): string[] => {
  const bodyStart = declaration.indexOf('{');
  if (bodyStart === -1) {
    return [];
  }
  return [declaration.slice(bodyStart)];
};

const callableDefaultSegment = (declaration: string): string[] => {
  const value = declaration.replace(/^\s*export\s+default\s+/, '');
  if (!/^\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(value)) {
    return [];
  }
  return [value.slice(value.indexOf('=>') + 2)];
};

const callableVariableSegment = (declaration: string): string[] => {
  const value = declarationInitializerValue(declaration);
  if (!/^\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(value)) {
    return [];
  }
  return [value.slice(value.indexOf('=>') + 2)];
};

const exportedCallableDeclarationSegment = (declaration: string): string[] => {
  if (/^\s*(?:export\s+)?(?:async\s+)?function\b/.test(declaration)) {
    return callableFunctionSegment(declaration);
  }
  if (/^\s*export\s+default\b/.test(declaration)) {
    return callableDefaultSegment(declaration);
  }
  if (/^\s*(?:export\s+)?(?:const|let|var)\b/.test(declaration)) {
    return callableVariableSegment(declaration);
  }
  return [];
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const exportedCallableDeclarationSegments = (source: string): string[] => {
  const cachedValue = exportedCallableDeclarationSegmentCache.get(source);
  if (cachedValue) {
    return cachedValue;
  }

  return cacheExportedCallableDeclarationSegments(
    source,
    exportedDeclarationTexts(source).flatMap(exportedCallableDeclarationSegment),
  );
};
