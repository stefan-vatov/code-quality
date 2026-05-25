/* -------------------------------------------------------------------------- */
/*               Effect workflow body and recursion predicates.               */
/* -------------------------------------------------------------------------- */
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
  return (
    /Effect\.flatMap\s*\([\s\S]*?=>[\s\S]*?\.pipe\s*\(\s*Effect\.flatMap/s.test(code) ||
    /Effect\.flatMap\s*\([^,]+,\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>[\s\S]*?Effect\.flatMap\s*\(/s.test(
      code,
    )
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasUnboundedEffectConcurrency = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\bEffect\.(?:forEach|all)\s*\(/g)) {
    if (
      /\{[\s\S]*?\bconcurrency\s*:\s*['"]unbounded['"]/.test(
        strippedCallSegment(source, match.index),
      )
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
export const hasUnboundedFlatMapConcurrency = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\bEffect\.flatMap\s*\(/g)) {
    if (
      /\{[\s\S]*?\bconcurrency\s*:\s*['"]unbounded['"]/.test(
        strippedCallSegment(source, match.index),
      )
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
export const hasParsedJSONNumberFromString = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\bJSON\.parse\s*\(/g)) {
    const statementStart = Math.max(
      code.lastIndexOf(';', match.index) + 1,
      code.lastIndexOf('\n', match.index) + 1,
    );
    const statementEnd = findStatementEnd(code, statementStart);
    if (
      /\b(?:[A-Za-z_$][\w$]*NumberFromString|Schema\.NumberFromString)\b/.test(
        code.slice(statementStart, statementEnd + 1),
      )
    ) {
      return true;
    }
  }

  return false;
};

const hasEffectInCallbackCall = (source: string, callPattern: RegExp): boolean => {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(callPattern)) {
    const openParenIndex = source.indexOf('(', match.index);
    const callBody = source.slice(openParenIndex + 1, findBalancedCallEnd(source, openParenIndex));
    if (/(?:=>|function\b)[\s\S]*?\bEffect\./.test(stripCommentsAndStrings(callBody))) {
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
  return effectCallBodies(source, effectCallPattern(source, 'gen')).some((body): boolean =>
    returnEffectPattern.test(stripCommentsAndStrings(body)),
  );
};

const yieldWithoutStarIndex = (source: string, matchIndex: number): number | undefined => {
  const openParenIndex = source.indexOf('(', matchIndex);
  if (openParenIndex === -1) {
    return undefined;
  }

  const bodyStart = openParenIndex + 1;
  const body = source.slice(bodyStart, findBalancedCallEnd(source, openParenIndex));
  const yieldMatch = /(?:^|[^\w$])(yield\s+(?!\*)[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)/.exec(
    stripCommentsAndStrings(body),
  );
  if (yieldMatch?.index === undefined) {
    return undefined;
  }
  return bodyStart + yieldMatch.index + yieldMatch[0].indexOf(yieldMatch[1]);
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasYieldWithoutStarInGen = (source: string): boolean | number => {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(effectCallPattern(source, 'gen'))) {
    const index = yieldWithoutStarIndex(source, match.index);
    if (index !== undefined) {
      return index;
    }
  }

  return false;
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
  effectCallBodies(source, effectCallPattern(source, 'sync')).some((body) => {
    const code = stripCommentsAndStrings(body);
    return /^\s*async\b/.test(code) || /\b(?:fetch|Promise\.)\s*\(/.test(code);
  });

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasSyncForThrowingOPS = (source: string): boolean =>
  effectCallBodies(source, effectCallPattern(source, 'sync')).some((body): boolean =>
    /\b(?:throw\b|JSON\.parse\s*\()/.test(stripCommentsAndStrings(body)),
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
  if (objectEnd === -1) {
    return undefined;
  }
  return {
    body: code.slice(start + 1, objectEnd),
    rawBody: source.slice(start + 1, objectEnd),
  };
};

const catchTailFor = (body: string, rawBody: string): string => {
  const catchIndex = body.search(/\bcatch\s*:/);
  if (catchIndex === -1) {
    return '';
  }
  return stripComments(rawBody.slice(catchIndex));
};

const hasUnsafeTryPromiseObjectBody = (body: string, rawBody: string): boolean => {
  if (/\btry\s*:/.test(body) && !/\bcatch\s*:/.test(body)) {
    return true;
  }
  const catchTail = catchTailFor(body, rawBody);
  return (
    /^\s*catch\s*:[\s\S]*?=>\s*(?:new\s+Error\s*\(|['"`])/.test(catchTail) ||
    /^\s*catch\s*:[\s\S]*?=>\s*\(\s*{(?![\s\S]*\b_tag\s*:)/.test(catchTail)
  );
};

/**
 * Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasTryPromiseWithoutTypedCatch = (source: string): boolean => {
  const code = stripCommentsAndStrings(source);
  if (/\bEffect\.tryPromise\s*\(\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(code)) {
    return true;
  }

  for (const match of code.matchAll(/Effect\.tryPromise\s*\(\s*{/g)) {
    const objectStart = code.indexOf('{', match.index);
    const objectBody = tryPromiseObjectBody(code, source, objectStart);
    if (objectBody && hasUnsafeTryPromiseObjectBody(objectBody.body, objectBody.rawBody)) {
      return true;
    }
  }

  return false;
};

const hasUnsafeRecursiveBody = (name: string, body: string): boolean => {
  const code = stripCommentsAndStrings(body);
  if (!/\bEffect\.(?:flatMap|forEach|gen)\b/.test(code)) {
    return false;
  }

  const recursiveCallPattern = new RegExp(`\\b${name}\\s*\\(`, 'g');
  for (const match of code.matchAll(recursiveCallPattern)) {
    if (!isInsideCall(code, match.index, /Effect\.suspend\s*\(/g)) {
      return true;
    }
  }

  return false;
};

const hasUnsafeRecursiveFunction = (source: string): boolean => {
  for (const match of source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*{/g)) {
    const [, name] = match;
    const bodyStart = source.indexOf('{', match.index);
    const bodyEnd = findMatchingBrace(source, bodyStart);
    if (bodyEnd !== -1 && hasUnsafeRecursiveBody(name, source.slice(bodyStart + 1, bodyEnd))) {
      return true;
    }
  }
  return false;
};

const recursiveArrowBody = (source: string, bodyStart: number): string => {
  const expressionEnd = source.indexOf(';', bodyStart);
  if (source[bodyStart] === '{') {
    return source.slice(bodyStart + 1, findMatchingBrace(source, bodyStart));
  }
  if (expressionEnd === -1) {
    return source.slice(bodyStart, source.length);
  }
  return source.slice(bodyStart, expressionEnd);
};

const hasUnsafeRecursiveArrow = (source: string): boolean => {
  for (const match of source.matchAll(
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*/g,
  )) {
    const [, name] = match;
    if (hasUnsafeRecursiveBody(name, recursiveArrowBody(source, match.index + match[0].length))) {
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
export const hasRecursiveEffectWithoutSuspend = (source: string): boolean =>
  hasUnsafeRecursiveFunction(source) || hasUnsafeRecursiveArrow(source);
