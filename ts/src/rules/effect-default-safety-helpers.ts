/**
 * Error-handling and cleanup predicates for always-on Effect rules.
 *
 * @internal
 */
import { effectCallBodies, enclosingPipeBody } from './effect-default-scan-helpers';
import {
  findBalancedCallEnd,
  isInsideCall,
  stripCommentsAndStrings,
} from './effect-source-helpers';

const LOCAL_PREFIX_SCAN_WINDOW = 160;

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasUnsafeLazyEvaluation = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(
    /Effect\.succeed\s*\(\s*(?:Date\.now|Math\.random|new\s+Date|JSON\.parse)\s*\(/g,
  )) {
    if (!isInsideCall(code, match.index, /Effect\.suspend\s*\(/g)) {
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
export const hasUnloggedIgnore = (source: string): boolean => {
  for (const match of source.matchAll(/\bEffect\.ignore\b/g)) {
    const pipeBody = enclosingPipeBody(source, match.index);
    let localPrefix = source.slice(
      Math.max(0, match.index - LOCAL_PREFIX_SCAN_WINDOW),
      match.index,
    );
    if (pipeBody) {
      localPrefix = pipeBody.slice(0, Math.max(0, match.index - source.indexOf(pipeBody)));
    }
    if (!/\b(?:Effect\.log|tapError|tapBoth|catchAll)\b/.test(localPrefix)) {
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
export const hasMultipleCatchTagsInOnePipe = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\.pipe\s*\(/g)) {
    const openParenIndex = source.indexOf('(', match.index);
    if (openParenIndex !== -1) {
      const pipeBody = source.slice(match.index, findBalancedCallEnd(source, openParenIndex) + 1);
      const catchTagCount = [...pipeBody.matchAll(/Effect\.catchTag\s*\(/g)].length;
      if (catchTagCount > 1 && !/Effect\.catchTags\s*\(/.test(pipeBody)) {
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
export const hasBroadCatchAllWithoutRethrow = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/Effect\.catchAll\s*\(/g)) {
    const openParenIndex = source.indexOf('(', match.index);
    if (openParenIndex !== -1) {
      const callBody = source.slice(
        openParenIndex + 1,
        findBalancedCallEnd(source, openParenIndex),
      );
      if (!/=>\s*Effect\.fail\s*\(/.test(callBody)) {
        return true;
      }
    }
  }

  return false;
};

const hasErrorWithoutCause = (callBody: string): boolean => {
  for (const errorMatch of callBody.matchAll(/new\s+[A-Z][\w$]*Error\s*\(/g)) {
    const errorOpenParenIndex = callBody.indexOf('(', errorMatch.index);
    const errorArgs = callBody.slice(
      errorOpenParenIndex + 1,
      findBalancedCallEnd(callBody, errorOpenParenIndex),
    );
    if (!/\bcause\b/.test(errorArgs)) {
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
export const hasErrorMappingWithoutCause = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/(?:mapError|catchAll)\s*\(/g)) {
    const openParenIndex = source.indexOf('(', match.index);
    if (openParenIndex !== -1) {
      const callBody = source.slice(
        openParenIndex + 1,
        findBalancedCallEnd(source, openParenIndex),
      );
      if (hasErrorWithoutCause(callBody)) {
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
export const hasForkDaemonWithoutCleanup = (source: string): boolean =>
  effectCallBodies(source, /\bEffect\.forkDaemon\s*\(/g).some(
    (body): boolean =>
      !/\b(?:Effect\.)?(?:ensuring|onExit|onInterrupt|supervised)\b|Supervisor\./.test(body),
  );

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasForkInUninterruptibleWithoutRestore = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\bEffect\.uninterruptible\s*\(/g)) {
    const openParenIndex = source.indexOf('(', match.index);
    const callBody = source.slice(openParenIndex + 1, findBalancedCallEnd(source, openParenIndex));
    if (/\bEffect\.fork\b/.test(callBody) && !/\brestore\s*\(/.test(callBody)) {
      return true;
    }
  }

  return false;
};
