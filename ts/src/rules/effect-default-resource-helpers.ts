/* -------------------------------------------------------------------------- */
/*              Helpers for Effect resource-lifetime lint rules.              */
/* -------------------------------------------------------------------------- */
import { Array, Match, Option, pipe } from 'effect';
import {
  findBalancedCallEnd,
  isInsideCall,
  stripCommentsAndStrings,
} from './effect-source-helpers';

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasUnreleasedAcquire = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    [...code.matchAll(/Effect\.(?:sync|try|tryPromise)\s*\(/g)],
    Array.some((match): boolean => {
      const openParenIndex = code.indexOf('(', match.index);
      const callSource = code.slice(match.index, findBalancedCallEnd(code, openParenIndex) + 1);
      return (
        /\b(?:open|connect|subscribe|listen)\w*\s*\(/.test(callSource) &&
        !isInsideCall(code, match.index, /Effect\.acquireRelease\s*\(/g)
      );
    }),
  );
};

const assignedBindingNameBefore = (source: string, targetIndex: number): string | undefined =>
  pipe(
    source.slice(source.lastIndexOf(';', targetIndex) + 1, targetIndex),
    (prefix): RegExpExecArray | null => /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(prefix),
    Option.fromNullable,
    Option.flatMapNullable((match): string | undefined => match[1]),
    Option.getOrUndefined,
  );

const scopedCallBody = (source: string, match: RegExpExecArray): string => {
  const openParenIndex = source.indexOf('(', match.index);
  return source.slice(openParenIndex + 1, findBalancedCallEnd(source, openParenIndex));
};

const isBindingUsedInScopedBoundary = (source: string, bindingName: string): boolean => {
  const bindingPattern = new RegExp(`\\b${bindingName}\\b`);
  return pipe(
    [...source.matchAll(/\b(?:Effect|Layer)\.scoped\s*\(/g)],
    Array.some((match): boolean => bindingPattern.test(scopedCallBody(source, match))),
  );
};

const isOptionalBindingUsedInScopedBoundary = (
  source: string,
  bindingName: string | undefined,
): boolean =>
  pipe(
    Option.fromNullable(bindingName),
    Option.match({
      onNone: (): boolean => false,
      onSome: (name): boolean => isBindingUsedInScopedBoundary(source, name),
    }),
  );

const pipeScopedBody = (source: string, pipeStart: number): string => {
  const openParenIndex = source.indexOf('(', pipeStart);
  return source.slice(openParenIndex + 1, findBalancedCallEnd(source, openParenIndex));
};

const hasScopedPipeAfterCall = (source: string, callEndIndex: number): boolean => {
  const tail = source.slice(callEndIndex + 1);
  return pipe(
    Option.fromNullable(/^\s*\.pipe\s*\(/.exec(tail)),
    Option.match({
      onNone: (): boolean => false,
      onSome: (pipeMatch): boolean => {
        const pipeStart = callEndIndex + 1 + pipeMatch.index;
        return /\b(?:Effect|Layer)\.scoped\b/.test(pipeScopedBody(source, pipeStart));
      },
    }),
  );
};

const hasUnscopedAcquireReleaseMatch = (code: string, match: RegExpExecArray): boolean => {
  const bindingName = assignedBindingNameBefore(code, match.index);
  const openParenIndex = code.indexOf('(', match.index);
  const callEndIndex = findBalancedCallEnd(code, openParenIndex);
  return (
    !isInsideCall(code, match.index, /\b(?:Effect|Layer)\.scoped\s*\(/g) &&
    !hasScopedPipeAfterCall(code, callEndIndex) &&
    !isOptionalBindingUsedInScopedBoundary(code, bindingName)
  );
};

const hasUnscopedResourceWorkflowMatch = (code: string, match: RegExpExecArray): boolean =>
  Match.value(match.index).pipe(
    Match.orElse(
      (index): boolean => !isInsideCall(code, index, /\b(?:Effect|Layer)\.scoped\s*\(/g),
    ),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasUnscopedAcquireRelease = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    [...code.matchAll(/Effect\.acquireRelease\s*\(/g)],
    Array.some((match): boolean => hasUnscopedAcquireReleaseMatch(code, match)),
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasUnscopedResourceWorkflow = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  return pipe(
    [...code.matchAll(/\b(?:Socket|Connection)\.(?:open|connect|listen|subscribe)\w*\s*\(/g)],
    Array.some((match): boolean => hasUnscopedResourceWorkflowMatch(code, match)),
  );
};
