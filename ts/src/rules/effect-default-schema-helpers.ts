/**
 * Schema boundary predicates for always-on Effect rules.
 *
 * @internal
 */
import { isInsideCall, stripCommentsAndStrings } from './effect-source-helpers';
import { localCallSegment, someEffectWorkflowBody } from './effect-default-scan-helpers';

const SCHEMA_ASSERTION_SCAN_WINDOW = 240;

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasSchemaSyncDecodeInEffectWorkflow = (source: string): boolean =>
  someEffectWorkflowBody(source, (body): boolean =>
    /Schema\.decode(?:Unknown)?Sync\s*\(/.test(stripCommentsAndStrings(body)),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasSchemaPromiseDecode = (source: string): boolean =>
  /Schema\.decode[A-Za-z]*Promise\s*\(/.test(stripCommentsAndStrings(source));

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasExternalJSONWithoutDecodeUnknown = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\b(?:response|res)\.json\s*\(\s*\)/g)) {
    const callSegment = localCallSegment(code, match.index);
    if (
      !isInsideCall(code, match.index, /Schema\.decodeUnknown\s*\(/g) &&
      !/Schema\.decodeUnknown/.test(callSegment)
    ) {
      return true;
    }
  }

  return false;
};

const schemaDecodeLine = (code: string, index: number): string => {
  const lineStart = Math.max(code.lastIndexOf(';', index) + 1, code.lastIndexOf('\n', index) + 1);
  const lineBreakIndex = code.indexOf('\n', index);
  let lineEnd = lineBreakIndex;
  if (lineEnd === -1) {
    lineEnd = code.length;
  }
  return code.slice(lineStart, lineEnd);
};

const schemaAssertionTail = (code: string, match: RegExpMatchArray): string =>
  code.slice(
    (match.index ?? 0) + match[0].length,
    (match.index ?? 0) + match[0].length + SCHEMA_ASSERTION_SCAN_WINDOW,
  );

const hasBindingAssertion = (bindingName: string | undefined, tail: string): boolean =>
  Boolean(bindingName && new RegExp(`\\b${bindingName}\\s+as\\s+[A-Za-z_$][\\w$]*`).test(tail));

const hasInlineSchemaDecodeCast = (line: string): boolean =>
  /Schema\.decode[A-Za-z]*\s*\([^)]*\)\s*\([^)]*\)\s+as\s+[A-Za-z_$][\w$]*/.test(line);

const hasCastAfterSchemaDecodeMatch = (code: string, match: RegExpMatchArray): boolean => {
  if (match.index === undefined) {
    return false;
  }
  const line = schemaDecodeLine(code, match.index);
  if (hasInlineSchemaDecodeCast(line)) {
    return true;
  }
  const bindingName = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line)?.[1];
  return hasBindingAssertion(bindingName, schemaAssertionTail(code, match));
};

const hasCastAfterSchemaDecodeBinding = (code: string): boolean => {
  for (const match of code.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*Schema\.decode[A-Za-z]*\s*\([^)]*\)\s*\([^)]*\)/g,
  )) {
    const [, bindingName] = match;
    if (hasBindingAssertion(bindingName, schemaAssertionTail(code, match))) {
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
  for (const match of code.matchAll(/Schema\.decode[A-Za-z]*\s*\(/g)) {
    if (hasCastAfterSchemaDecodeMatch(code, match)) {
      return true;
    }
  }

  return hasCastAfterSchemaDecodeBinding(code);
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasUnhandledSchemaEffectDecode = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*Schema\.decodeUnknown\s*\([^)]*\)\s*\([^)]*\)/g,
  )) {
    const [, bindingName] = match;
    const tail = code.slice(match.index + match[0].length);
    const handledPattern = new RegExp(
      `(?:yield\\*\\s+${bindingName}\\b|return\\s+${bindingName}\\b)`,
    );
    if (!handledPattern.test(tail)) {
      return true;
    }
  }

  return /Schema\.decodeUnknown\s*\([^)]*\)\s*\([^)]*\)\.pipe\s*\(\s*Effect\.(?:orDie|ignore)\b/.test(
    code,
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
