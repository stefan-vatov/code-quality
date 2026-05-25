/* -------------------------------------------------------------------------- */
/*      Boundary-schema predicates for opt-in strict Effect lint rules.       */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';
import {
  findBalancedCallEnd,
  findStatementEnd,
  isInsideCall,
  stripCommentsAndStrings,
} from './effect-source-helpers';

const NEARBY_SCHEMA_SCAN_WINDOW = 240;
const LOCAL_CONTEXT_WINDOW = 160;

const lineAround = (source: string, targetIndex: number): string => {
  const start = source.lastIndexOf('\n', targetIndex) + 1;
  const end = Match.value(source.indexOf('\n', targetIndex)).pipe(
    Match.when(
      (lineEnd): boolean => lineEnd === -1,
      (): number => source.length,
    ),
    Match.orElse((lineEnd): number => lineEnd),
  );
  return source.slice(start, end);
};

const boundaryAccessSegment = (code: string, match: RegExpMatchArray): string => {
  const matchIndex = match.index ?? 0;
  const accessEnd = matchIndex + match[0].length;
  const tail = code.slice(accessEnd);
  return pipe(
    Option.fromNullable(/^\s*\.pipe\s*\(/.exec(tail)),
    Option.match({
      onNone: (): string => code.slice(matchIndex, accessEnd),
      onSome: (): string =>
        code.slice(matchIndex, accessEnd + findBalancedCallEnd(tail, tail.indexOf('(')) + 1),
    }),
  );
};

const boundaryAccessNeedsSchema = (code: string, match: RegExpMatchArray): boolean =>
  !isInsideCall(code, match.index ?? 0, /Schema\.decode[A-Za-z]*\s*\(/g) &&
  !/Schema\.decode/.test(boundaryAccessSegment(code, match));

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasBoundaryDataWithoutSchema = (source: string): boolean =>
  Match.value(source).pipe(
    Match.when(
      (value): boolean =>
        !value.includes('.body') &&
        !value.includes('.params') &&
        !value.includes('.query') &&
        !value.includes('.payload'),
      (): boolean => false,
    ),
    Match.orElse((value): boolean => {
      const code = stripCommentsAndStrings(value);
      return pipe(
        [...code.matchAll(/(?:req|request|command|message)\.(?:body|params|query|payload)/g)],
        Array.some((match): boolean => boundaryAccessNeedsSchema(code, match)),
      );
    }),
  );

const requestBindingNeedsSchema = (code: string, match: RegExpMatchArray): boolean =>
  pipe(
    Option.fromNullable(match.index),
    Option.match({
      onNone: (): boolean => false,
      onSome: (index): boolean => {
        const line = lineAround(code, index);
        const bindingName = pipe(
          Option.fromNullable(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\b/.exec(line)),
          Option.flatMapNullable((bindingMatch): string | undefined => bindingMatch[1]),
          Option.getOrUndefined,
        );
        const tail = code.slice(index, findStatementEnd(code, index) + NEARBY_SCHEMA_SCAN_WINDOW);
        return Match.value(line).pipe(
          Match.when(
            (localLine): boolean => /Schema\.decode/.test(localLine),
            (): boolean => false,
          ),
          Match.orElse(
            (): boolean =>
              !pipe(
                Option.fromNullable(bindingName),
                Option.exists((name): boolean =>
                  new RegExp(`Schema\\.decode[A-Za-z]*\\s*\\([^)]*\\)\\s*\\(\\s*${name}\\b`).test(
                    tail,
                  ),
                ),
              ),
          ),
        );
      },
    }),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasHTTPServerRequestWithoutSchema = (source: string): boolean =>
  Match.value(source).pipe(
    Match.when(
      (value): boolean => !value.includes('HttpRouter.') && !value.includes('HttpServerRequest'),
      (): boolean => false,
    ),
    Match.orElse((value): boolean => {
      const code = stripCommentsAndStrings(value);
      return Match.value(code).pipe(
        Match.when(
          (strippedCode): boolean => !/\b(?:HttpRouter\.|HttpServerRequest\b)/.test(strippedCode),
          (): boolean => false,
        ),
        Match.orElse((strippedCode): boolean =>
          pipe(
            [...strippedCode.matchAll(/\b(?:body|Body|json|Json|urlParams)\b/g)],
            Array.some((match): boolean => requestBindingNeedsSchema(strippedCode, match)),
          ),
        ),
      );
    }),
  );

const hasNearbySchemaDecodeForBinding = (tail: string, bindingName: string | undefined): boolean =>
  pipe(
    Option.fromNullable(bindingName),
    Option.exists((name): boolean =>
      new RegExp(`Schema\\.decode[A-Za-z]*\\s*\\([^)]*\\)\\s*\\(\\s*${name}\\b`).test(tail),
    ),
  );

const persistenceReadNeedsSchema = (code: string, match: RegExpExecArray): boolean => {
  const localSource = lineAround(code, match.index);
  const bindingName = pipe(
    Option.fromNullable(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\b/.exec(localSource)),
    Option.flatMapNullable((bindingMatch): string | undefined => bindingMatch[1]),
    Option.getOrUndefined,
  );
  const tail = code.slice(
    match.index,
    findStatementEnd(code, match.index) + NEARBY_SCHEMA_SCAN_WINDOW,
  );
  return !/Schema\.decode/.test(localSource) && !hasNearbySchemaDecodeForBinding(tail, bindingName);
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasPersistenceReadWithoutSchema = (source: string): boolean =>
  Match.value(source).pipe(
    Match.when(
      (value): boolean =>
        !value.includes('db.') &&
        !value.includes('database.') &&
        !value.includes('collection.') &&
        !value.includes('repository.'),
      (): boolean => false,
    ),
    Match.orElse((value): boolean => {
      const code = stripCommentsAndStrings(value);
      return pipe(
        [
          ...code.matchAll(
            /\b(?:db|database|collection|repository)\.[\s\S]*?(?:select|find|get|query)\s*\(/g,
          ),
        ],
        Array.some((match): boolean => persistenceReadNeedsSchema(code, match)),
      );
    }),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasCommandHandlerWithoutSchema = (source: string): boolean =>
  Match.value(source).pipe(
    Match.when(
      (value): boolean =>
        !value.includes('handler') ||
        (!value.includes('Command') &&
          !value.includes('Cli') &&
          !value.includes('Job') &&
          !value.includes('Message')),
      (): boolean => false,
    ),
    Match.orElse((value): boolean => {
      const code = stripCommentsAndStrings(value);
      return pipe(
        [...code.matchAll(/\b(?:Command|Cli|Job|Message)\b[\s\S]*?handler/g)],
        Array.some((match): boolean => {
          const localSource = code.slice(
            Math.max(0, match.index - LOCAL_CONTEXT_WINDOW),
            match.index + LOCAL_CONTEXT_WINDOW,
          );
          return !/(?:Schema\.|schema\s*:)/.test(localSource);
        }),
      );
    }),
  );
