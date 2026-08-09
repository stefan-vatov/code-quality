/* -------------------------------------------------------------------------- */
/*           Schema boundary predicates for always-on Effect rules.           */
/* -------------------------------------------------------------------------- */
import { Array, pipe } from 'effect';
import { isInsideCall, stripCommentsAndStrings } from './effect-source-helpers';
import { localCallSegment } from './effect-default-scan-helpers';

const SCHEMA_ASSERTION_SCAN_WINDOW = 240;
const SCHEMA_DECODE_PATTERN = /Schema\.decode[A-Za-z]*\s*\(/g;
const SCHEMA_DECODE_BINDING_PATTERN =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*Schema\.decode[A-Za-z]*\s*\([^)]*\)\s*\([^)]*\)/g;
const SCHEMA_BINDING_DECLARATION_PATTERN =
  /\b(?:const|let|var)[^\S\n]+([A-Za-z_$][\w$]*)[^\S\n]*=/g;
const SCHEMA_ASSERTION_PATTERN = /\b([A-Za-z_$][\w$]*)\s+as\s+[A-Za-z_$][\w$]*/g;
const INLINE_SCHEMA_DECODE_CAST_PATTERN =
  /Schema\.decode[A-Za-z]*[^\S\n]*\([^)\n]*\)[^\S\n]*\([^)\n]*\)[^\S\n]+as[^\S\n]+[A-Za-z_$][\w$]*/g;
const SCHEMA_DECODE_ERROR_PIPE_PATTERN =
  /Schema\.decodeUnknown\s*\([^)]*\)\s*\([^)]*\)\.pipe\s*\(\s*Effect\.(?:orDie|ignore)\b/;
const SCHEMA_HANDLED_BINDING_PATTERN = /(?:yield\*\s+|return\s+(?!yield\*))([A-Za-z_$][\w$]*)\b/g;
const SCHEMA_DECODE_UNKNOWN_BINDING_PATTERN =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*Schema\.decodeUnknown\s*\([^)]*\)\s*\([^)]*\)/g;

const firstIndexAtOrAfter = (indexes: readonly number[], targetIndex: number): number => {
  let low = 0;
  let high = indexes.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((indexes[middle] ?? Number.POSITIVE_INFINITY) < targetIndex) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasExternalJSONWithoutDecodeUnknown = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    [...code.matchAll(/\b(?:response|res)\.json\s*\(\s*\)/g)],
    Array.some((match): boolean => {
      const callSegment = localCallSegment(code, match.index);
      return (
        !isInsideCall(code, match.index, /Schema\.decodeUnknown\s*\(/g) &&
        !/Schema\.decodeUnknown/.test(callSegment)
      );
    }),
  );
};

const hasBindingAssertionInRange = (
  positions: ReadonlyMap<string, readonly number[]>,
  bindingName: string | undefined,
  startIndex: number,
): boolean => {
  if (bindingName === undefined) {
    return false;
  }
  const bindingPositions = positions.get(bindingName);
  if (bindingPositions === undefined) {
    return false;
  }
  const assertionIndex = firstIndexAtOrAfter(bindingPositions, startIndex);
  const assertionPosition = bindingPositions[assertionIndex];
  return (
    assertionPosition !== undefined && assertionPosition < startIndex + SCHEMA_ASSERTION_SCAN_WINDOW
  );
};

const collectMatchIndexes = (code: string, pattern: RegExp): number[] => {
  const indexes: number[] = [];
  for (const match of code.matchAll(pattern)) {
    indexes.push(match.index);
  }
  return indexes;
};

const collectSchemaAssertions = (code: string): Map<string, number[]> => {
  const positions = new Map<string, number[]>();
  for (const match of code.matchAll(SCHEMA_ASSERTION_PATTERN)) {
    const [, bindingName] = match;
    if (bindingName !== undefined) {
      const bindingPositions = positions.get(bindingName) ?? [];
      bindingPositions.push(match.index);
      positions.set(bindingName, bindingPositions);
    }
  }
  return positions;
};

interface SchemaBindingDeclaration {
  readonly index: number;
  readonly name: string;
}

const collectSchemaBindingDeclarations = (code: string): SchemaBindingDeclaration[] => {
  const declarations: SchemaBindingDeclaration[] = [];
  for (const match of code.matchAll(SCHEMA_BINDING_DECLARATION_PATTERN)) {
    const [, name] = match;
    if (name !== undefined) {
      declarations.push({ index: match.index, name });
    }
  }
  return declarations;
};

interface SourceLineBounds {
  readonly end: number;
  readonly start: number;
}

const sourceLineBoundsScanner = (code: string): ((matchIndex: number) => SourceLineBounds) => {
  let scanIndex = 0;
  let lineStart = 0;
  let lineEnd = code.indexOf('\n');
  return (matchIndex): SourceLineBounds => {
    while (scanIndex < matchIndex) {
      if (code[scanIndex] === ';' || code[scanIndex] === '\n') {
        lineStart = scanIndex + 1;
      }
      scanIndex += 1;
    }
    while (lineEnd !== -1 && lineEnd < matchIndex) {
      lineEnd = code.indexOf('\n', lineEnd + 1);
    }
    let end = lineEnd;
    if (end === -1) {
      end = code.length;
    }
    return { end, start: lineStart };
  };
};

const firstSchemaDeclarationScanner = (
  declarations: readonly SchemaBindingDeclaration[],
): ((lineStart: number, lineEnd: number) => SchemaBindingDeclaration | undefined) => {
  let declarationIndex = 0;
  return (lineStart, lineEnd): SchemaBindingDeclaration | undefined => {
    while (declarationIndex < declarations.length) {
      const declaration = declarations[declarationIndex];
      if (declaration === undefined || declaration.index >= lineStart) {
        break;
      }
      declarationIndex += 1;
    }
    const declaration = declarations[declarationIndex];
    if (declaration !== undefined && declaration.index < lineEnd) {
      return declaration;
    }
    return undefined;
  };
};

const hasInlineSchemaCastInRange = (
  indexes: readonly number[],
  lineStart: number,
  lineEnd: number,
): boolean => {
  const inlineCastIndex = firstIndexAtOrAfter(indexes, lineStart);
  const inlineCastPosition = indexes[inlineCastIndex];
  return inlineCastPosition !== undefined && inlineCastPosition < lineEnd;
};

const hasSchemaDecodeCastOnLine = (
  code: string,
  assertions: ReadonlyMap<string, readonly number[]>,
  inlineCastIndexes: readonly number[],
  declarations: readonly SchemaBindingDeclaration[],
): boolean => {
  const getLineBounds = sourceLineBoundsScanner(code);
  const getDeclaration = firstSchemaDeclarationScanner(declarations);
  for (const match of code.matchAll(SCHEMA_DECODE_PATTERN)) {
    const bounds = getLineBounds(match.index);
    if (hasInlineSchemaCastInRange(inlineCastIndexes, bounds.start, bounds.end)) {
      return true;
    }
    const declaration = getDeclaration(bounds.start, bounds.end);
    if (
      declaration !== undefined &&
      hasBindingAssertionInRange(assertions, declaration.name, match.index + match[0].length)
    ) {
      return true;
    }
  }
  return false;
};

const hasSchemaDecodeBindingCast = (
  code: string,
  assertions: ReadonlyMap<string, readonly number[]>,
): boolean => {
  for (const match of code.matchAll(SCHEMA_DECODE_BINDING_PATTERN)) {
    const [, bindingName] = match;
    if (hasBindingAssertionInRange(assertions, bindingName, match.index + match[0].length)) {
      return true;
    }
  }
  return false;
};

const collectHandledBindingPositions = (code: string): Map<string, number[]> => {
  const positions = new Map<string, number[]>();
  for (const match of code.matchAll(SCHEMA_HANDLED_BINDING_PATTERN)) {
    const [, bindingName] = match;
    if (bindingName !== undefined) {
      const bindingPositions = positions.get(bindingName) ?? [];
      bindingPositions.push(match.index);
      positions.set(bindingName, bindingPositions);
    }
  }
  return positions;
};

const hasHandledBindingAfter = (
  positions: ReadonlyMap<string, readonly number[]>,
  bindingName: string | undefined,
  startIndex: number,
): boolean => {
  if (bindingName === undefined) {
    return false;
  }
  const bindingPositions = positions.get(bindingName);
  if (bindingPositions === undefined) {
    return false;
  }
  return firstIndexAtOrAfter(bindingPositions, startIndex) < bindingPositions.length;
};

const hasUnhandledSchemaDecodeBinding = (
  code: string,
  handledBindingPositions: ReadonlyMap<string, readonly number[]>,
): boolean => {
  for (const match of code.matchAll(SCHEMA_DECODE_UNKNOWN_BINDING_PATTERN)) {
    const [, bindingName] = match;
    if (
      !hasHandledBindingAfter(handledBindingPositions, bindingName, match.index + match[0].length)
    ) {
      return true;
    }
  }
  return false;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasCastAfterSchemaDecode = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  const assertions = collectSchemaAssertions(code);
  const inlineCastIndexes = collectMatchIndexes(code, INLINE_SCHEMA_DECODE_CAST_PATTERN);
  const declarations = collectSchemaBindingDeclarations(code);
  return (
    hasSchemaDecodeCastOnLine(code, assertions, inlineCastIndexes, declarations) ||
    hasSchemaDecodeBindingCast(code, assertions) ||
    SCHEMA_DECODE_ERROR_PIPE_PATTERN.test(code)
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasUnhandledSchemaEffectDecode = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  const handledBindingPositions = collectHandledBindingPositions(code);
  return (
    hasUnhandledSchemaDecodeBinding(code, handledBindingPositions) ||
    SCHEMA_DECODE_ERROR_PIPE_PATTERN.test(code)
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasJSONParsedBeforeSchemaStringDecode = (source: string): boolean =>
  /Schema\.decode[A-Za-z]*\s*\((?![^)]*Schema\.parseJson)[\s\S]*?\)\s*\(\s*JSON\.parse\s*\(/.test(
    stripCommentsAndStrings(source),
  );
