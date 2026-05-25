/* -------------------------------------------------------------------------- */
/*           Schema boundary predicates for always-on Effect rules.           */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';
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

const schemaDecodeLine = (code: string, index: number): string => {
  const lineStart = Math.max(code.lastIndexOf(';', index) + 1, code.lastIndexOf('\n', index) + 1);
  const lineBreakIndex = code.indexOf('\n', index);
  const lineEnd = Match.value(lineBreakIndex).pipe(
    Match.when(
      (breakIndex): boolean => breakIndex === -1,
      (): number => code.length,
    ),
    Match.orElse((breakIndex): number => breakIndex),
  );
  return code.slice(lineStart, lineEnd);
};

const schemaAssertionTail = (code: string, match: RegExpMatchArray): string =>
  code.slice(
    (match.index ?? 0) + match[0].length,
    (match.index ?? 0) + match[0].length + SCHEMA_ASSERTION_SCAN_WINDOW,
  );

const hasBindingAssertion = (bindingName: string | undefined, tail: string): boolean =>
  pipe(
    Option.fromNullable(bindingName),
    Option.match({
      onNone: (): boolean => false,
      onSome: (name): boolean => new RegExp(`\\b${name}\\s+as\\s+[A-Za-z_$][\\w$]*`).test(tail),
    }),
  );

const hasInlineSchemaDecodeCast = (line: string): boolean =>
  /Schema\.decode[A-Za-z]*\s*\([^)]*\)\s*\([^)]*\)\s+as\s+[A-Za-z_$][\w$]*/.test(line);

const hasCastAfterSchemaDecodeMatch = (code: string, match: RegExpMatchArray): boolean =>
  pipe(
    Option.fromNullable(match.index),
    Option.match({
      onNone: (): boolean => false,
      onSome: (index): boolean => {
        const line = schemaDecodeLine(code, index);
        return Match.value(line).pipe(
          Match.when(
            (schemaLine): boolean => hasInlineSchemaDecodeCast(schemaLine),
            (): boolean => true,
          ),
          Match.orElse((schemaLine): boolean => {
            const bindingName = pipe(
              Option.fromNullable(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(schemaLine)),
              Option.flatMapNullable((bindingMatch): string | undefined => bindingMatch[1]),
              Option.getOrUndefined,
            );
            return hasBindingAssertion(bindingName, schemaAssertionTail(code, match));
          }),
        );
      },
    }),
  );

const hasCastAfterSchemaDecodeBinding = (code: string): boolean =>
  pipe(
    [
      ...code.matchAll(
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*Schema\.decode[A-Za-z]*\s*\([^)]*\)\s*\([^)]*\)/g,
      ),
    ],
    Array.some((match): boolean => {
      const [, bindingName] = match;
      return hasBindingAssertion(bindingName, schemaAssertionTail(code, match));
    }),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasCastAfterSchemaDecode = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  return (
    pipe(
      [...code.matchAll(/Schema\.decode[A-Za-z]*\s*\(/g)],
      Array.some((match): boolean => hasCastAfterSchemaDecodeMatch(code, match)),
    ) || hasCastAfterSchemaDecodeBinding(code)
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasUnhandledSchemaEffectDecode = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  return (
    pipe(
      [
        ...code.matchAll(
          /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*Schema\.decodeUnknown\s*\([^)]*\)\s*\([^)]*\)/g,
        ),
      ],
      Array.some((match): boolean => {
        const [, bindingName] = match;
        const tail = code.slice(match.index + match[0].length);
        const handledPattern = new RegExp(
          `(?:yield\\*\\s+${bindingName}\\b|return\\s+${bindingName}\\b)`,
        );
        return !handledPattern.test(tail);
      }),
    ) ||
    /Schema\.decodeUnknown\s*\([^)]*\)\s*\([^)]*\)\.pipe\s*\(\s*Effect\.(?:orDie|ignore)\b/.test(
      code,
    )
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
