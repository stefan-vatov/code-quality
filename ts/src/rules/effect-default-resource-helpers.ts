/* -------------------------------------------------------------------------- */
/*              Helpers for Effect resource-lifetime lint rules.              */
/* -------------------------------------------------------------------------- */
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
  for (const match of code.matchAll(/Effect\.(?:sync|try|tryPromise)\s*\(/g)) {
    const openParenIndex = code.indexOf('(', match.index);
    const callSource = code.slice(match.index, findBalancedCallEnd(code, openParenIndex) + 1);
    if (
      /\b(?:open|connect|subscribe|listen)\w*\s*\(/.test(callSource) &&
      !isInsideCall(code, match.index, /Effect\.acquireRelease\s*\(/g)
    ) {
      return true;
    }
  }

  return false;
};

const assignedBindingNameBefore = (source: string, targetIndex: number): string | undefined => {
  const statementStart = source.lastIndexOf(';', targetIndex) + 1;
  const prefix = source.slice(statementStart, targetIndex);
  return /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(prefix)?.[1];
};

const isBindingUsedInScopedBoundary = (source: string, bindingName: string): boolean => {
  const bindingPattern = new RegExp(`\\b${bindingName}\\b`);
  for (const match of source.matchAll(/\b(?:Effect|Layer)\.scoped\s*\(/g)) {
    const openParenIndex = source.indexOf('(', match.index);
    const scopedBody = source.slice(
      openParenIndex + 1,
      findBalancedCallEnd(source, openParenIndex),
    );
    if (bindingPattern.test(scopedBody)) {
      return true;
    }
  }

  return false;
};

const hasScopedPipeAfterCall = (source: string, callEndIndex: number): boolean => {
  const tail = source.slice(callEndIndex + 1);
  const pipeMatch = /^\s*\.pipe\s*\(/.exec(tail);
  if (!pipeMatch) {
    return false;
  }

  const pipeStart = callEndIndex + 1 + pipeMatch.index;
  const openParenIndex = source.indexOf('(', pipeStart);
  const pipeBody = source.slice(openParenIndex + 1, findBalancedCallEnd(source, openParenIndex));
  return /\b(?:Effect|Layer)\.scoped\b/.test(pipeBody);
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasUnscopedAcquireRelease = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/Effect\.acquireRelease\s*\(/g)) {
    const bindingName = assignedBindingNameBefore(code, match.index);
    const openParenIndex = code.indexOf('(', match.index);
    const callEndIndex = findBalancedCallEnd(code, openParenIndex);
    if (
      !isInsideCall(code, match.index, /\b(?:Effect|Layer)\.scoped\s*\(/g) &&
      !hasScopedPipeAfterCall(code, callEndIndex) &&
      !(bindingName && isBindingUsedInScopedBoundary(code, bindingName))
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
export const hasUnscopedResourceWorkflow = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(
    /\b(?:Socket|Connection)\.(?:open|connect|listen|subscribe)\w*\s*\(/g,
  )) {
    if (!isInsideCall(code, match.index, /\b(?:Effect|Layer)\.scoped\s*\(/g)) {
      return true;
    }
  }

  return false;
};
