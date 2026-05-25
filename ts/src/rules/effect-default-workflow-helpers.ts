/* -------------------------------------------------------------------------- */
/*               Effect workflow body and recursion predicates.               */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';
import {
  effectAliasesPattern,
  effectCallBodies,
  effectCallPattern,
  someEffectWorkflowBody,
  strippedCallSegment,
} from './effect-default-scan-helpers';
import {
  findBalancedCallEnd,
  findMatchingBrace,
  findStatementEnd,
  isInsideCall,
  stripComments,
  stripCommentsAndStrings,
} from './effect-source-helpers';
import { hasRuntimeCall } from './effect-rule-core';

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasRuntimeInEffect = (source: string): boolean =>
  someEffectWorkflowBody(source, (body): boolean => hasRuntimeCall(body));

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasNestedFlatMap = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    [
      /Effect\.flatMap\s*\([\s\S]*?=>[\s\S]*?\.pipe\s*\(\s*Effect\.flatMap/s,
      /Effect\.flatMap\s*\([^,]+,\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>[\s\S]*?Effect\.flatMap\s*\(/s,
    ],
    Array.some((pattern): boolean => pattern.test(code)),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasParsedJSONNumberFromString = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    Array.fromIterable(code.matchAll(/\bJSON\.parse\s*\(/g)),
    Array.some((match): boolean => {
      const statementStart = Math.max(
        code.lastIndexOf(';', match.index) + 1,
        code.lastIndexOf('\n', match.index) + 1,
      );
      const statementEnd = findStatementEnd(code, statementStart);
      return /\b(?:[A-Za-z_$][\w$]*NumberFromString|Schema\.NumberFromString)\b/.test(
        code.slice(statementStart, statementEnd + 1),
      );
    }),
  );
};

const hasEffectInCallbackCall = (source: string, callPattern: RegExp): boolean => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    Array.fromIterable(code.matchAll(callPattern)),
    Array.some((match): boolean => {
      const openParenIndex = source.indexOf('(', match.index);
      const callBody = source.slice(
        openParenIndex + 1,
        findBalancedCallEnd(source, openParenIndex),
      );
      return /(?:=>|function\b)[\s\S]*?\bEffect\./.test(stripCommentsAndStrings(callBody));
    }),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasEffectInArrayForEach = (source: string): boolean =>
  hasEffectInCallbackCall(source, /\b(?!Effect\b)[A-Za-z_$][\w$]*\.forEach\s*\(/g);

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasEffectInPromiseCallback = (source: string): boolean =>
  hasEffectInCallbackCall(source, /\.(?:then|catch)\s*\(/g);

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasReturnEffectInGen = (source: string): boolean => {
  const returnEffectPattern = new RegExp(
    `\\breturn\\s+(?:${effectAliasesPattern(source)})\\.(?!isEffect\\b|serviceFunction\\b)`,
  );
  return pipe(
    effectCallBodies(source, effectCallPattern(source, 'gen')),
    Array.some((body): boolean => returnEffectPattern.test(stripCommentsAndStrings(body))),
  );
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasYieldWithoutStarInGen = (source: string): boolean | number => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    Array.fromIterable(code.matchAll(effectCallPattern(source, 'gen'))),
    Array.findFirst((match): boolean => yieldWithoutStarIndex(source, match.index) !== undefined),
    Option.flatMap((match) => Option.fromNullable(yieldWithoutStarIndex(source, match.index))),
    Option.getOrElse((): false => false),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasAsyncAwaitInEffect = (source: string): boolean =>
  someEffectWorkflowBody(source, (body): boolean =>
    /(?:^|[({,]\s*)async\b|\bawait\b/.test(stripCommentsAndStrings(body)),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasSyncForPromise = (source: string): boolean =>
  pipe(
    effectCallBodies(source, effectCallPattern(source, 'sync')),
    Array.some((body): boolean => {
      const code = stripCommentsAndStrings(body);
      return /^\s*async\b/.test(code) || /\b(?:fetch|Promise\.)\s*\(/.test(code);
    }),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasSyncForThrowingOPS = (source: string): boolean =>
  pipe(
    effectCallBodies(source, effectCallPattern(source, 'sync')),
    Array.some((body): boolean =>
      /\b(?:throw\b|JSON\.parse\s*\()/.test(stripCommentsAndStrings(body)),
    ),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasThrowInEffect = (source: string): boolean =>
  someEffectWorkflowBody(source, (body): boolean =>
    /\bthrow\b/.test(stripCommentsAndStrings(body)),
  );

const tryPromiseObjectBody = (
  code: string,
  source: string,
  start: number,
): { body: string; rawBody: string } | undefined => {
  const objectEnd = findMatchingBrace(code, start);
  return Match.value(objectEnd).pipe(
    Match.when(-1, (): undefined => undefined),
    Match.orElse((end): { body: string; rawBody: string } => ({
      body: code.slice(start + 1, end),
      rawBody: source.slice(start + 1, end),
    })),
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
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

const hasUnsafeRecursiveBody = (name: string, body: string): boolean => {
  const code = stripCommentsAndStrings(body);
  return Match.value(/\bEffect\.(?:flatMap|forEach|gen)\b/.test(code)).pipe(
    Match.when(false, (): boolean => false),
    Match.orElse((): boolean => {
      const recursiveCallPattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
      return pipe(
        Array.fromIterable(code.matchAll(recursiveCallPattern)),
        Array.some((match): boolean => !isInsideCall(code, match.index, /Effect\.suspend\s*\(/g)),
      );
    }),
  );
};

const hasUnsafeRecursiveFunction = (source: string): boolean =>
  pipe(
    Array.fromIterable(source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*{/g)),
    Array.some((match): boolean => {
      const [, name] = match;
      const bodyStart = source.indexOf('{', match.index);
      const bodyEnd = findMatchingBrace(source, bodyStart);
      return bodyEnd !== -1 && hasUnsafeRecursiveBody(name, source.slice(bodyStart + 1, bodyEnd));
    }),
  );

const recursiveArrowBody = (source: string, bodyStart: number): string => {
  const expressionEnd = source.indexOf(';', bodyStart);
  return Match.value(source[bodyStart]).pipe(
    Match.when('{', (): string =>
      source.slice(bodyStart + 1, findMatchingBrace(source, bodyStart)),
    ),
    Match.orElse((): string =>
      Match.value(expressionEnd).pipe(
        Match.when(-1, (): string => source.slice(bodyStart, source.length)),
        Match.orElse((end): string => source.slice(bodyStart, end)),
      ),
    ),
  );
};

const hasUnsafeRecursiveArrow = (source: string): boolean =>
  pipe(
    Array.fromIterable(
      source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*/g),
    ),
    Array.some((match): boolean => {
      const [, name] = match;
      return hasUnsafeRecursiveBody(
        name,
        recursiveArrowBody(source, match.index + match[0].length),
      );
    }),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasRecursiveEffectWithoutSuspend = (source: string): boolean =>
  hasUnsafeRecursiveFunction(source) || hasUnsafeRecursiveArrow(source);
