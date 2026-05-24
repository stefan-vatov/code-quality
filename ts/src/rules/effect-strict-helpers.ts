/**
 * Helper predicates for opt-in strict Effect lint rules.
 *
 * @internal
 */
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

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasOutputBoundaryWithoutSchema = (source: string): boolean => {
  if (!source.includes('Response.json') && !source.includes('return json')) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\breturn\s+(?:Response\.json|json)\s*\(/g)) {
    const callOffset = match[0].search(/(?:Response\.json|json)\s*\(/);
    const segment = localEffectCallSegment(source, match.index + callOffset);
    if (!/Schema\.(?:encode|decode)/.test(segment)) {
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
export const hasHTTPClientResponseWithoutSchema = (source: string): boolean => {
  if (!source.includes('HttpClient.') || !source.includes('response.json')) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\bHttpClient\.[\s\S]*?\bresponse\.json\s*\(/g)) {
    const segment = localStatementSegment(source, match.index);
    if (!/Schema\.decode/.test(segment)) {
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
export const hasSharedResourceForEachWithoutSemaphore = (source: string): boolean => {
  if (!source.includes('Effect.forEach')) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\bEffect\.forEach\s*\(/g)) {
    const localStart = Math.max(0, match.index - RESOURCE_CONTEXT_WINDOW);
    const segment = code.slice(localStart, findStatementEnd(code, match.index) + 1);
    if (
      /\b(?:pool|connection|client|browser|worker)\b/.test(segment) &&
      !/\bSemaphore\b/.test(segment)
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
export const hasEnsuringCleanupWithoutOnExit = (source: string): boolean => {
  if (!source.includes('Effect.ensuring') || !source.includes('cleanup')) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\bEffect\.ensuring\s*\(/g)) {
    const segment = localEffectCallSegment(source, match.index);
    if (/\bcleanup\b/.test(segment) && !/\bonExit\b/.test(segment)) {
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
export const hasUnterminatedLongRunningStream = (source: string): boolean => {
  if (!source.includes('Stream.')) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\bStream\.(?:repeat|forever|async|fromQueue)\s*\(/g)) {
    const segment = localEffectCallSegment(source, match.index);
    if (!/\b(?:takeUntil|interruptWhen|timeout)\b/.test(segment)) {
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
export const hasAsyncPushWithoutBuffer = (source: string): boolean => {
  if (!source.includes('Stream.asyncPush')) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\bStream\.asyncPush\s*\(/g)) {
    const segment = localEffectCallSegment(source, match.index);
    if (!/\b(?:buffer|Queue\.bounded|Queue\.sliding)\b/.test(segment)) {
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
export const hasUnbatchedResolver = (source: string): boolean => {
  if (!source.includes('RequestResolver.make')) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\bRequestResolver\.make\s*\(/g)) {
    const segment = localEffectCallSegment(source, match.index);
    if (!/\b(?:makeBatched|batchN|grouped)\b/.test(segment)) {
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
export const hasNPlusOneWithoutBatchedResolver = (source: string): boolean => {
  if (!source.includes('Effect.forEach')) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\bEffect\.forEach\s*\(/g)) {
    const segment = localEffectCallSegment(source, match.index);
    if (
      /\b(?:findById|getById|loadById)\s*\(/.test(segment) &&
      !/\bRequestResolver\b/.test(segment)
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
export const hasUnprovidedServiceInEffectTest = (source: string): boolean => {
  if (!source.includes('Service') && !source.includes('Repo') && !source.includes('Client')) {
    return false;
  }

  return testSegments(source).some(
    (segment): boolean =>
      /yield\*\s+[A-Z][\w$]*(?:Service|Repo|Client)\b/.test(segment) &&
      !/\b(?:Effect\.)?provide[A-Za-z_$]*\s*\(/.test(segment),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasTimeCodeWithoutTestClock = (source: string): boolean => {
  if (
    !source.includes('Effect.timeout') &&
    !source.includes('Effect.delay') &&
    !source.includes('Clock.')
  ) {
    return false;
  }

  return testSegments(source).some(
    (segment): boolean =>
      /Effect\.(?:timeout|delay)|Clock\./.test(segment) && !/TestClock/.test(segment),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasMutableStateWithoutRef = (source: string): boolean => {
  if (!source.includes('let ')) {
    return false;
  }

  if (!hasEffectSignal(source)) {
    return false;
  }

  for (const match of source.matchAll(/\blet\s+[A-Za-z_$][\w$]*\s*=/g)) {
    if (!/\bRef\./.test(lineAround(source, match.index))) {
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
export const hasSharedMutableStateWithoutRef = hasMutableStateWithoutRef;
