/* -------------------------------------------------------------------------- */
/*           Helper predicates for opt-in strict Effect lint rules.           */
/* -------------------------------------------------------------------------- */
import { Array, String, pipe } from 'effect';
import { findStatementEnd, stripCommentsAndStrings } from './effect-source-helpers';
import {
  lineAround,
  localEffectCallSegment,
  localStatementSegment,
  testSegments,
} from './effect-strict-segment-helpers';
import { hasEffectSignal } from './effect-rule-core';

export {
  hasBoundaryDataWithoutSchema,
  hasCommandHandlerWithoutSchema,
  hasHTTPServerRequestWithoutSchema,
  hasPersistenceReadWithoutSchema,
} from './effect-strict-boundary-helpers';
export {
  hasExternalEffectWithoutSpan,
  hasExternalEffectWithoutTimeout,
  hasIdempotentExternalEffectWithoutRetry,
} from './effect-strict-external-helpers';
export {
  hasDuplicateLayerInstance,
  hasLayerFactory,
  hasLiveTestService,
  hasRealTestService,
  hasUnscopedResourceLayer,
  hasUnscopedResourceLoop,
  hasUnsafeResourceStream,
} from './effect-strict-segment-helpers';

const RESOURCE_CONTEXT_WINDOW = 180;

const sourceIncludes =
  (needle: string) =>
  (source: string): boolean =>
    pipe(source, String.includes(needle));

const matchesIn = (source: string, pattern: RegExp): readonly RegExpExecArray[] =>
  pipe(source.matchAll(pattern), Array.fromIterable);

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasOutputBoundaryWithoutSchema = (source: string): boolean => {
  if (!sourceIncludes('Response.json')(source) && !sourceIncludes('return json')(source)) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  return pipe(
    matchesIn(code, /\breturn\s+(?:Response\.json|json)\s*\(/g),
    Array.some((match): boolean => {
      const callOffset = match[0].search(/(?:Response\.json|json)\s*\(/);
      const segment = localEffectCallSegment(source, match.index + callOffset);
      return !/Schema\.(?:encode|decode)/.test(segment);
    }),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasHTTPClientResponseWithoutSchema = (source: string): boolean => {
  if (!sourceIncludes('HttpClient.')(source) || !sourceIncludes('response.json')(source)) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  return pipe(
    matchesIn(code, /\bHttpClient\.[\s\S]*?\bresponse\.json\s*\(/g),
    Array.some((match): boolean => {
      const segment = localStatementSegment(source, match.index);
      return !/Schema\.decode/.test(segment);
    }),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasSharedResourceForEachWithoutSemaphore = (source: string): boolean => {
  if (!sourceIncludes('Effect.forEach')(source)) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  return pipe(
    matchesIn(code, /\bEffect\.forEach\s*\(/g),
    Array.some((match): boolean => {
      const localStart = Math.max(0, match.index - RESOURCE_CONTEXT_WINDOW);
      const segment = code.slice(localStart, findStatementEnd(code, match.index) + 1);
      return (
        /\b(?:pool|connection|client|browser|worker)\b/.test(segment) &&
        !/\bSemaphore\b/.test(segment)
      );
    }),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasEnsuringCleanupWithoutOnExit = (source: string): boolean => {
  if (!sourceIncludes('Effect.ensuring')(source) || !sourceIncludes('cleanup')(source)) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  return pipe(
    matchesIn(code, /\bEffect\.ensuring\s*\(/g),
    Array.some((match): boolean => {
      const segment = localEffectCallSegment(source, match.index);
      return /\bcleanup\b/.test(segment) && !/\bonExit\b/.test(segment);
    }),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasUnterminatedLongRunningStream = (source: string): boolean => {
  if (!sourceIncludes('Stream.')(source)) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  return pipe(
    matchesIn(code, /\bStream\.(?:repeat|forever|async|fromQueue)\s*\(/g),
    Array.some((match): boolean => {
      const segment = localEffectCallSegment(source, match.index);
      return !/\b(?:takeUntil|interruptWhen|timeout)\b/.test(segment);
    }),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasAsyncPushWithoutBuffer = (source: string): boolean => {
  if (!sourceIncludes('Stream.asyncPush')(source)) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  return pipe(
    matchesIn(code, /\bStream\.asyncPush\s*\(/g),
    Array.some((match): boolean => {
      const segment = localEffectCallSegment(source, match.index);
      return !/\b(?:buffer|Queue\.bounded|Queue\.sliding)\b/.test(segment);
    }),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasUnbatchedResolver = (source: string): boolean => {
  if (!sourceIncludes('RequestResolver.make')(source)) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  return pipe(
    matchesIn(code, /\bRequestResolver\.make\s*\(/g),
    Array.some((match): boolean => {
      const segment = localEffectCallSegment(source, match.index);
      return !/\b(?:makeBatched|batchN|grouped)\b/.test(segment);
    }),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasNPlusOneWithoutBatchedResolver = (source: string): boolean => {
  if (!sourceIncludes('Effect.forEach')(source)) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  return pipe(
    matchesIn(code, /\bEffect\.forEach\s*\(/g),
    Array.some((match): boolean => {
      const segment = localEffectCallSegment(source, match.index);
      return (
        /\b(?:findById|getById|loadById)\s*\(/.test(segment) && !/\bRequestResolver\b/.test(segment)
      );
    }),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasUnprovidedServiceInEffectTest = (source: string): boolean => {
  if (
    !sourceIncludes('Service')(source) &&
    !sourceIncludes('Repo')(source) &&
    !sourceIncludes('Client')(source)
  ) {
    return false;
  }

  return pipe(
    testSegments(source),
    Array.some(
      (segment): boolean =>
        /yield\*\s+[A-Z][\w$]*(?:Service|Repo|Client)\b/.test(segment) &&
        !/\b(?:Effect\.)?provide[A-Za-z_$]*\s*\(/.test(segment),
    ),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasTimeCodeWithoutTestClock = (source: string): boolean => {
  if (
    !sourceIncludes('Effect.timeout')(source) &&
    !sourceIncludes('Effect.delay')(source) &&
    !sourceIncludes('Clock.')(source)
  ) {
    return false;
  }

  return pipe(
    testSegments(source),
    Array.some(
      (segment): boolean =>
        /Effect\.(?:timeout|delay)|Clock\./.test(segment) && !/TestClock/.test(segment),
    ),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasMutableStateWithoutRef = (source: string): boolean => {
  if (!sourceIncludes('let ')(source)) {
    return false;
  }

  if (!hasEffectSignal(source)) {
    return false;
  }

  return pipe(
    matchesIn(source, /\blet\s+[A-Za-z_$][\w$]*\s*=/g),
    Array.some((match): boolean => !/\bRef\./.test(lineAround(source, match.index))),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasSharedMutableStateWithoutRef = hasMutableStateWithoutRef;
