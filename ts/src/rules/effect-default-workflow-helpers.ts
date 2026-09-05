import { Array, Match, Option, pipe } from 'effect';
import {
  effectAliasesPattern,
  effectCallPattern,
  someEffectGenBodyMatch,
  strippedCallSegment,
} from './effect-default-scan-helpers';
import {
  findBalancedCallEnd,
  findMatchingBrace,
  findStatementEnd,
  stripComments,
  stripCommentsAndStrings,
} from './effect-source-helpers';
import { hasRecursiveEffectSource } from './effect-recursion-source';

const JSON_PARSE_PATTERN = /\bJSON\.parse\s*\(/g;
const JSON_NUMBER_FROM_STRING_PATTERN =
  /\b(?:[A-Za-z_$][\w$]*NumberFromString|Schema\.NumberFromString)\b/g;

interface PromiseObjectBody {
  readonly body: string;
  readonly rawBody: string;
}

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

const matchIndexes = (code: string, pattern: RegExp): number[] => {
  const indexes: number[] = [];
  for (const match of code.matchAll(pattern)) {
    indexes.push(match.index);
  }
  return indexes;
};

const statementStartScanner = (code: string): ((matchIndex: number) => number) => {
  let scanIndex = 0;
  let statementStart = 0;
  return (matchIndex): number => {
    while (scanIndex < matchIndex) {
      if (code[scanIndex] === ';' || code[scanIndex] === '\n') {
        statementStart = scanIndex + 1;
      }
      scanIndex += 1;
    }
    return statementStart;
  };
};

const hasIndexAtOrBefore = (
  indexes: readonly number[],
  startIndex: number,
  endIndex: number,
): boolean => {
  const firstIndex = firstIndexAtOrAfter(indexes, startIndex);
  const index = indexes[firstIndex];
  return index !== undefined && index <= endIndex;
};

export const hasUnboundedEffectConcurrency = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    Array.fromIterable(code.matchAll(/\bEffect\.(?:forEach|all)\s*\(/g)),
    Array.some((match): boolean =>
      /\{[\s\S]*?\bconcurrency\s*:\s*['"]unbounded['"]/.test(
        strippedCallSegment(source, match.index),
      ),
    ),
  );
};

export const hasUnboundedFlatMapConcurrency = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    Array.fromIterable(code.matchAll(/\bEffect\.flatMap\s*\(/g)),
    Array.some((match): boolean =>
      /\{[\s\S]*?\bconcurrency\s*:\s*['"]unbounded['"]/.test(
        strippedCallSegment(source, match.index),
      ),
    ),
  );
};

export const hasParsedJSONNumberFromString = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  const numberFromStringIndexes = matchIndexes(code, JSON_NUMBER_FROM_STRING_PATTERN);
  const getStatementStart = statementStartScanner(code);
  for (const match of code.matchAll(JSON_PARSE_PATTERN)) {
    const statementStart = getStatementStart(match.index);
    const statementEnd = findStatementEnd(code, statementStart);
    if (hasIndexAtOrBefore(numberFromStringIndexes, statementStart, statementEnd)) {
      return true;
    }
  }
  return false;
};

export const hasReturnEffectInGen = (source: string): boolean => {
  const returnEffectPattern = new RegExp(
    `\\breturn\\s+(?:${effectAliasesPattern(source)})\\.(?!isEffect\\b|serviceFunction\\b)`,
    'g',
  );
  return someEffectGenBodyMatch(source, returnEffectPattern);
};

const yieldWithoutStarIndex = (source: string, matchIndex: number): number | undefined => {
  const openParenIndex = source.indexOf('(', matchIndex);
  return Match.value(openParenIndex).pipe(
    Match.when(-1, (): undefined => undefined),
    Match.orElse((parenIndex): number | undefined => {
      const bodyStart = parenIndex + 1;
      const body = source.slice(bodyStart, findBalancedCallEnd(source, parenIndex));
      return pipe(
        Option.fromNullable(
          /(?:^|[^\w$])(yield\s+(?!\*)[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)/.exec(
            stripCommentsAndStrings(body),
          ),
        ),
        Option.flatMap((yieldMatch) =>
          pipe(
            Option.fromNullable(yieldMatch.index),
            Option.map((index): number => bodyStart + index + yieldMatch[0].indexOf(yieldMatch[1])),
          ),
        ),
        Option.getOrUndefined,
      );
    }),
  );
};

export const hasYieldWithoutStarInGen = (source: string): boolean | number => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    Array.fromIterable(code.matchAll(effectCallPattern(source, 'gen'))),
    Array.findFirst((match): boolean => yieldWithoutStarIndex(source, match.index) !== undefined),
    Option.flatMap((match) => Option.fromNullable(yieldWithoutStarIndex(source, match.index))),
    Option.getOrElse((): false => false),
  );
};

const tryPromiseObjectBody = (
  code: string,
  source: string,
  start: number,
): PromiseObjectBody | undefined => {
  const objectEnd = findMatchingBrace(code, start);
  return Match.value(objectEnd).pipe(
    Match.when(-1, (): undefined => undefined),
    Match.orElse(
      (end): PromiseObjectBody => ({
        body: code.slice(start + 1, end),
        rawBody: source.slice(start + 1, end),
      }),
    ),
  );
};

const catchTailFor = (body: string, rawBody: string): string => {
  const catchIndex = body.search(/\bcatch\s*:/);
  return Match.value(catchIndex).pipe(
    Match.when(-1, (): string => ''),
    Match.orElse((index): string => stripComments(rawBody.slice(index))),
  );
};

const hasUnsafeTryPromiseObjectBody = (body: string, rawBody: string): boolean =>
  Match.value(/\btry\s*:/.test(body) && !/\bcatch\s*:/.test(body)).pipe(
    Match.when(true, (): boolean => true),
    Match.orElse((): boolean => {
      const catchTail = catchTailFor(body, rawBody);
      return pipe(
        [
          /^\s*catch\s*:[\s\S]*?=>\s*(?:new\s+Error\s*\(|['"`])/,
          /^\s*catch\s*:[\s\S]*?=>\s*\(\s*{(?![\s\S]*\b_tag\s*:)/,
        ],
        Array.some((pattern): boolean => pattern.test(catchTail)),
      );
    }),
  );

export const hasTryPromiseWithoutTypedCatch = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  return Match.value(
    /\bEffect\.tryPromise\s*\(\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(code),
  ).pipe(
    Match.when(true, (): boolean => true),
    Match.orElse((): boolean =>
      pipe(
        Array.fromIterable(code.matchAll(/Effect\.tryPromise\s*\(\s*{/g)),
        Array.some((match): boolean => {
          const objectStart = code.indexOf('{', match.index);
          return pipe(
            Option.fromNullable(tryPromiseObjectBody(code, source, objectStart)),
            Option.exists((objectBody): boolean =>
              hasUnsafeTryPromiseObjectBody(objectBody.body, objectBody.rawBody),
            ),
          );
        }),
      ),
    ),
  );
};

export const hasRecursiveEffectWithoutSuspend = hasRecursiveEffectSource;
