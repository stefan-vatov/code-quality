/* -------------------------------------------------------------------------- */
/*       External-call predicates for opt-in strict Effect lint rules.        */
/* -------------------------------------------------------------------------- */
import {
  enclosingEffectWrapperSegment,
  hasTopLevelPipeOperator,
  localEffectCallSegment,
} from './effect-strict-segment-helpers';
import { isInsideCall, stripComments, stripCommentsAndStrings } from './effect-source-helpers';
import { hasEffectSignal } from './effect-rule-core';

const EXTERNAL_CALL_PATTERN =
  /\b(?:HttpClient\.(?:get|post|put|patch|delete|request)|fetch|FileSystem\.[A-Za-z_$][\w$]*|SqlClient\.[A-Za-z_$][\w$]*)\s*\(/g;
const IDEMPOTENT_EXTERNAL_CALL_PATTERN =
  /\b(?:HttpClient\.(?:get|head|put|delete)|fetch|(?:find|lookup|read)[A-Z]\w*)\s*\(/g;

const hasExternalCallSignal = (source: string): boolean =>
  source.includes('HttpClient.') ||
  source.includes('fetch') ||
  source.includes('FileSystem.') ||
  source.includes('SqlClient.');

const isFetchSkipped = (
  matchText: string,
  enclosingWrapper: string | undefined,
  options: { allowFetch: boolean },
): boolean => matchText.startsWith('fetch') && (!enclosingWrapper || !options.allowFetch);

const shouldReportMissingTimeout = (code: string, index: number, segment: string): boolean =>
  !isInsideCall(code, index, /Effect\.timeout\s*\(/g) &&
  !hasTopLevelPipeOperator(segment, 'timeout');

const hasExternalEffectMissingOperator = (
  source: string,
  options: { allowFetch: boolean },
  shouldReport: (code: string, index: number, segment: string) => boolean,
): boolean => {
  if (!hasExternalCallSignal(source)) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(EXTERNAL_CALL_PATTERN)) {
    const enclosingWrapper = enclosingEffectWrapperSegment(code, match.index);
    if (!isFetchSkipped(match[0], enclosingWrapper, options)) {
      const segment = enclosingWrapper ?? localEffectCallSegment(code, match.index);
      if (shouldReport(code, match.index, segment)) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasExternalEffectWithoutTimeout = (
  source: string,
  options: { allowFetch: boolean } = { allowFetch: true },
): boolean => hasExternalEffectMissingOperator(source, options, shouldReportMissingTimeout);

const shouldReportMissingSpan = (source: string, index: number, segment: string): boolean =>
  !isInsideCall(source, index, /Effect\.withSpan\s*\(/g) &&
  !hasTopLevelPipeOperator(segment, 'withSpan');

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasExternalEffectWithoutSpan = (
  source: string,
  options: { allowFetch: boolean } = { allowFetch: true },
): boolean => hasExternalEffectMissingOperator(source, options, shouldReportMissingSpan);

const hasIdempotentExternalCallSignal = (source: string): boolean =>
  source.includes('HttpClient.') ||
  source.includes('fetch') ||
  source.includes('find') ||
  source.includes('lookup') ||
  source.includes('read');

const isUnrelatedNamedRead = (source: string, matchText: string): boolean =>
  /^(?:find|lookup|read)[A-Z]/.test(matchText) && !hasEffectSignal(source);

const isMutatingFetchCall = (matchText: string, rawSegment: string): boolean =>
  matchText.startsWith('fetch') &&
  /\bmethod\s*:\s*['"](?!(?:GET|HEAD|PUT|DELETE)['"])/.test(stripComments(rawSegment));

const retryScanInput = (
  source: string,
  code: string,
  match: RegExpMatchArray,
  options: { allowFetch: boolean },
): { isMutatingFetch: boolean; segment: string; shouldSkipFetch: boolean } => {
  const index = match.index ?? 0;
  const enclosingWrapper = enclosingEffectWrapperSegment(code, index);
  const rawEnclosingWrapper = enclosingEffectWrapperSegment(source, index);
  const rawSegment = rawEnclosingWrapper ?? localEffectCallSegment(source, index);
  return {
    isMutatingFetch: isMutatingFetchCall(match[0], rawSegment),
    segment: enclosingWrapper ?? localEffectCallSegment(code, index),
    shouldSkipFetch: isFetchSkipped(match[0], enclosingWrapper, options),
  };
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasIdempotentExternalEffectWithoutRetry = (
  source: string,
  options: { allowFetch: boolean } = { allowFetch: true },
): boolean => {
  if (!hasIdempotentExternalCallSignal(source)) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(IDEMPOTENT_EXTERNAL_CALL_PATTERN)) {
    if (!isUnrelatedNamedRead(source, match[0])) {
      const input = retryScanInput(source, code, match, options);
      if (
        shouldReportMissingRetry(
          code,
          match.index,
          input.segment,
          input.shouldSkipFetch,
          input.isMutatingFetch,
        )
      ) {
        return true;
      }
    }
  }

  return false;
};

const shouldReportMissingRetry = (
  code: string,
  index: number,
  segment: string,
  shouldSkipFetch: boolean,
  isMutatingFetch: boolean,
): boolean => !shouldSkipFetch && !isMutatingFetch && isMissingRetryPolicy(code, index, segment);

const isMissingRetryPolicy = (code: string, index: number, segment: string): boolean =>
  !isInsideCall(code, index, /Effect\.retry\s*\(/g) && !hasTopLevelPipeOperator(segment, 'retry');
