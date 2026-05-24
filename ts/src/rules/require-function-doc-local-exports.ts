/** @internal Local export-list documentation helpers for exported JSDoc checks. */

const CHAR_CODE_OPEN_BRACE = 123;
const CHAR_CODE_LOWER_A = 97;
const CHAR_CODE_LOWER_Z = 122;
const CHAR_CODE_UPPER_A = 65;
const CHAR_CODE_UPPER_Z = 90;
const TYPE_KEYWORD_LENGTH = 'type '.length;

const skipWhitespace = (source: string, pos: number): number => {
  let cursor = pos;
  while (cursor < source.length && /\s/u.test(source[cursor] ?? '')) {
    cursor++;
  }
  return cursor;
};

const exportStatementEnd = (source: string, afterExport: number): number => {
  const semicolon = source.indexOf(';', afterExport);
  if (semicolon === -1) {
    return source.indexOf('\n', afterExport);
  }
  return semicolon;
};

const hasFromClauseBefore = (source: string, openBrace: number, statementEnd: number): boolean => {
  let end = statementEnd;
  if (end === -1) {
    end = source.length;
  }
  return source.slice(openBrace, end).includes(' from ');
};

const localExportOpenBrace = (source: string, afterExport: number): number => {
  if (
    source.slice(afterExport, afterExport + TYPE_KEYWORD_LENGTH) === 'type ' &&
    afterExport + TYPE_KEYWORD_LENGTH < source.length
  ) {
    return skipWhitespace(source, afterExport + TYPE_KEYWORD_LENGTH);
  }
  return afterExport;
};

const localExportListBounds = (
  source: string,
  afterExport: number,
): { closeBrace: number; openBrace: number } | undefined => {
  const openBrace = localExportOpenBrace(source, afterExport);
  if (source.charCodeAt(openBrace) !== CHAR_CODE_OPEN_BRACE) {
    return undefined;
  }

  const closeBrace = source.indexOf('}', openBrace);
  if (closeBrace === -1) {
    return undefined;
  }
  if (hasFromClauseBefore(source, openBrace, exportStatementEnd(source, closeBrace))) {
    return undefined;
  }
  return { closeBrace, openBrace };
};

const localExportName = (part: string): string =>
  part
    .trim()
    .replace(/^type\s+/u, '')
    .split(/\s+as\s+/u)[0]
    ?.trim() ?? '';

const localExportNames = (source: string, afterExport: number): readonly string[] | undefined => {
  const bounds = localExportListBounds(source, afterExport);
  if (!bounds) {
    return undefined;
  }

  return source
    .slice(bounds.openBrace + 1, bounds.closeBrace)
    .split(',')
    .map(localExportName)
    .filter(Boolean);
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
  let bestPosition = -1;
  for (const needle of declarationNeedles(name)) {
    const pos = source.lastIndexOf(needle, exportPOS);
    if (pos > bestPosition && isIdentifierBoundaryAfter(source, pos + needle.length)) {
      bestPosition = pos;
    }
  }
  if (bestPosition === -1) {
    return undefined;
  }
  return bestPosition;
};

/** Internal helper exported for package-local composition.
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
  if (!names) {
    return undefined;
  }
  return names.every((name): boolean => {
    const declarationPOS = localDeclarationPosition(source, name, exportPOS);
    return declarationPOS !== undefined && hasJSDocBefore(source, declarationPOS);
  });
};
