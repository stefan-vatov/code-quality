/* -------------------------------------------------------------------------- */
/*       External-call predicates for opt-in strict Effect lint rules.        */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';
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
  pipe(
    ['HttpClient.', 'fetch', 'FileSystem.', 'SqlClient.'],
    Array.some((needle): boolean => source.includes(needle)),
  );

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
): boolean =>
  Match.value(source).pipe(
    Match.when(
      (value): boolean => !hasExternalCallSignal(value),
      (): boolean => false,
    ),
    Match.orElse((value): boolean => {
      const code = stripCommentsAndStrings(value);
      return pipe(
        [...code.matchAll(EXTERNAL_CALL_PATTERN)],
        Array.some((match): boolean => {
          const enclosingWrapper = enclosingEffectWrapperSegment(code, match.index);
          return Match.value(isFetchSkipped(match[0], enclosingWrapper, options)).pipe(
            Match.when(
              (shouldSkip): boolean => shouldSkip,
              (): boolean => false,
            ),
            Match.orElse((): boolean => {
              const segment = enclosingWrapper ?? localEffectCallSegment(code, match.index);
              return shouldReport(code, match.index, segment);
            }),
          );
        }),
      );
    }),
  );

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
  pipe(
    ['HttpClient.', 'fetch', 'find', 'lookup', 'read'],
    Array.some((needle): boolean => source.includes(needle)),
  );

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
  const rawSegment = pipe(
    Option.fromNullable(rawEnclosingWrapper),
    Option.getOrElse((): string => localEffectCallSegment(source, index)),
  );
  return {
    isMutatingFetch: isMutatingFetchCall(match[0], rawSegment),
    segment: pipe(
      Option.fromNullable(enclosingWrapper),
      Option.getOrElse((): string => localEffectCallSegment(code, index)),
    ),
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
): boolean =>
  Match.value(source).pipe(
    Match.when(
      (value): boolean => !hasIdempotentExternalCallSignal(value),
      (): boolean => false,
    ),
    Match.orElse((value): boolean => {
      const code = stripCommentsAndStrings(value);
      return pipe(
        [...code.matchAll(IDEMPOTENT_EXTERNAL_CALL_PATTERN)],
        Array.some((match): boolean =>
          Match.value(isUnrelatedNamedRead(value, match[0])).pipe(
            Match.when(
              (shouldSkip): boolean => shouldSkip,
              (): boolean => false,
            ),
            Match.orElse((): boolean => {
              const input = retryScanInput(value, code, match, options);
              return shouldReportMissingRetry(
                code,
                match.index,
                input.segment,
                input.shouldSkipFetch,
                input.isMutatingFetch,
              );
            }),
          ),
        ),
      );
    }),
  );

const shouldReportMissingRetry = (
  code: string,
  index: number,
  segment: string,
  shouldSkipFetch: boolean,
  isMutatingFetch: boolean,
): boolean => !shouldSkipFetch && !isMutatingFetch && isMissingRetryPolicy(code, index, segment);

const isMissingRetryPolicy = (code: string, index: number, segment: string): boolean =>
  !isInsideCall(code, index, /Effect\.retry\s*\(/g) && !hasTopLevelPipeOperator(segment, 'retry');
