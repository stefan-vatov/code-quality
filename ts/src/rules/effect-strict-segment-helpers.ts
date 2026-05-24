/** @internal Source segment helpers for opt-in strict Effect lint rules. */
import {
  findBalancedCallEnd,
  findStatementEnd,
  isInsideCall,
  stripCommentsAndStrings,
} from './effect-source-helpers';

const SEGMENT_CACHE_MAX = 256;
const localEffectCallSegmentCache = new Map<string, Map<number, string>>();
const enclosingEffectWrapperSegmentCache = new Map<string, Map<number, string | undefined>>();
const CHAR_CODE_ZERO = 48;
const CHAR_CODE_NINE = 57;
const CHAR_CODE_UPPER_A = 65;
const CHAR_CODE_UPPER_Z = 90;
const CHAR_CODE_LOWER_A = 97;
const CHAR_CODE_LOWER_Z = 122;
const LOCAL_CONTEXT_WINDOW = 160;
const RESOURCE_CONTEXT_WINDOW = 180;

const sourceIndexCache = <Value>(
  cache: Map<string, Map<number, Value>>,
  source: string,
): Map<number, Value> => {
  let indexCache = cache.get(source);
  if (indexCache !== undefined) {
    return indexCache;
  }

  if (cache.size >= SEGMENT_CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }

  indexCache = new Map<number, Value>();
  cache.set(source, indexCache);
  return indexCache;
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const lineAround = (source: string, targetIndex: number): string => {
  const start = source.lastIndexOf('\n', targetIndex) + 1;
  let end = source.indexOf('\n', targetIndex);
  if (end === -1) {
    end = source.length;
  }
  return source.slice(start, end);
};

const isASCIIWhitespace = (character: string | undefined): boolean =>
  character === ' ' || character === '\n' || character === '\r' || character === '\t';

const isIdentifierPart = (character: string | undefined): boolean => {
  if (character === undefined || character === '$' || character === '_') {
    return character !== undefined;
  }

  const charCode = character.charCodeAt(0);
  return (
    (charCode >= CHAR_CODE_ZERO && charCode <= CHAR_CODE_NINE) ||
    (charCode >= CHAR_CODE_UPPER_A && charCode <= CHAR_CODE_UPPER_Z) ||
    (charCode >= CHAR_CODE_LOWER_A && charCode <= CHAR_CODE_LOWER_Z)
  );
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const testSegments = (source: string): string[] => {
  if (!source.includes('it(') && !source.includes('it.effect')) {
    return [source];
  }

  const code = stripCommentsAndStrings(source);
  const starts = [...code.matchAll(/\bit(?:\.effect)?\s*\(/g)].map((match) => match.index);
  if (starts.length === 0) {
    return [code];
  }

  return starts.map((start, index) => code.slice(start, starts[index + 1] ?? code.length));
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasLayerFactory = (source: string): boolean => {
  if (!source.includes('Layer.')) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  return (
    /export\s+function\s+[A-Za-z_$][\w$]*Layer\s*\([^)]*\)\s*{[\s\S]*?Layer\./.test(code) ||
    /export\s+const\s+[A-Za-z_$][\w$]*Layer\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>[\s\S]*?Layer\./.test(
      code,
    )
  );
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasUnscopedResourceLayer = (source: string): boolean => {
  if (!source.includes('Layer.effect')) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/Layer\.effect\s*\(/g)) {
    const openParenIndex = code.indexOf('(', match.index);
    const callSource = code.slice(match.index, findBalancedCallEnd(code, openParenIndex) + 1);
    if (
      /\b(?:open|connect|subscribe|listen)\w*\s*(?:\(|\)|$)/.test(callSource) &&
      !isInsideCall(code, match.index, /Layer\.scoped\s*\(/g)
    ) {
      return true;
    }
  }

  return false;
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasUnscopedResourceLoop = (source: string): boolean => {
  if (
    !source.includes('open') &&
    !source.includes('connect') &&
    !source.includes('subscribe') &&
    !source.includes('listen')
  ) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\b(?:open|connect|subscribe|listen)\w*\s*\(/g)) {
    const prefix = code.slice(Math.max(0, match.index - RESOURCE_CONTEXT_WINDOW), match.index);
    if (
      /\b(?:for|while)\b/.test(prefix) &&
      !isInsideCall(code, match.index, /Effect\.scoped\s*\(/g)
    ) {
      return true;
    }
  }

  return false;
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasUnsafeResourceStream = (source: string): boolean => {
  if (
    !source.includes('Stream.') ||
    (!source.includes('open') &&
      !source.includes('connect') &&
      !source.includes('subscribe') &&
      !source.includes('listen'))
  ) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\b(?:open|connect|subscribe|listen)\w*\s*\(/g)) {
    const prefix = code.slice(Math.max(0, match.index - RESOURCE_CONTEXT_WINDOW), match.index);
    if (
      /\bStream\./.test(prefix) &&
      !isInsideCall(code, match.index, /(?:Stream|Effect)\.scoped\s*\(/g)
    ) {
      return true;
    }
  }

  return false;
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasLiveTestService = (source: string): boolean => {
  if (!source.includes('Live') && !source.includes('Layer.live')) {
    return false;
  }

  return /(?:\bLive\b|[A-Za-z_$][\w$]*Live\b|Layer\.live)/.test(stripCommentsAndStrings(source));
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasRealTestService = (source: string): boolean => {
  if (!source.includes('real')) {
    return false;
  }

  return /\breal[A-Z]/.test(stripCommentsAndStrings(source));
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasDuplicateLayerInstance = (source: string): boolean => {
  if (!source.includes('Layer.')) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  const services = new Set<string>();
  for (const match of code.matchAll(
    /Layer\.(?:succeed|sync|effect|scoped|fromEffect|fromFunction)\s*\(\s*([A-Za-z_$][\w$]*)\b/g,
  )) {
    const [, serviceName] = match;
    if (services.has(serviceName)) {
      return true;
    }
    services.add(serviceName);
  }

  return false;
};

const localEffectCallEndIndex = (source: string, targetIndex: number): number | undefined => {
  const openParenIndex = source.indexOf('(', targetIndex);
  if (openParenIndex === -1) {
    return undefined;
  }
  let endIndex = findBalancedCallEnd(source, openParenIndex) + 1;
  const afterCall = source.slice(endIndex);
  const pipeMatch = /^\s*\.pipe\s*\(/.exec(afterCall);
  if (pipeMatch) {
    const pipeOpenIndex = endIndex + pipeMatch[0].lastIndexOf('(');
    endIndex = findBalancedCallEnd(source, pipeOpenIndex) + 1;
  }
  return endIndex;
};

const uncachedLocalEffectCallSegment = (source: string, targetIndex: number): string => {
  const endIndex = localEffectCallEndIndex(source, targetIndex);
  if (endIndex === undefined) {
    return source.slice(targetIndex, targetIndex + LOCAL_CONTEXT_WINDOW);
  }
  return source.slice(targetIndex, endIndex);
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const localEffectCallSegment = (source: string, targetIndex: number): string => {
  const indexCache = sourceIndexCache(localEffectCallSegmentCache, source);
  const cachedSegment = indexCache.get(targetIndex);
  if (cachedSegment !== undefined) {
    return cachedSegment;
  }

  const segment = uncachedLocalEffectCallSegment(source, targetIndex);
  indexCache.set(targetIndex, segment);
  return segment;
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const localStatementSegment = (source: string, targetIndex: number): string =>
  source.slice(targetIndex, findStatementEnd(source, targetIndex) + 1);

const effectWrapperEndIndex = (source: string, matchIndex: number, targetIndex: number): number => {
  const openParenIndex = source.indexOf('(', matchIndex);
  if (openParenIndex === -1 || openParenIndex > targetIndex) {
    return -1;
  }
  return findBalancedCallEnd(source, openParenIndex);
};

const uncachedEnclosingEffectWrapperSegment = (
  source: string,
  targetIndex: number,
): string | undefined => {
  if (!source.includes('Effect.promise') && !source.includes('Effect.tryPromise')) {
    return undefined;
  }

  for (const match of source.matchAll(/\bEffect\.(?:promise|tryPromise)\s*\(/g)) {
    const endIndex = effectWrapperEndIndex(source, match.index, targetIndex);
    if (endIndex !== -1 && targetIndex <= endIndex) {
      return localEffectCallSegment(source, match.index);
    }
  }
  return undefined;
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const enclosingEffectWrapperSegment = (
  source: string,
  targetIndex: number,
): string | undefined => {
  const indexCache = sourceIndexCache(enclosingEffectWrapperSegmentCache, source);
  if (indexCache.has(targetIndex)) {
    return indexCache.get(targetIndex);
  }

  const segment = uncachedEnclosingEffectWrapperSegment(source, targetIndex);
  indexCache.set(targetIndex, segment);
  return segment;
};

const isPipeOperatorAtTopLevel = (
  pipeBody: string,
  operatorIndex: number,
  operatorNeedle: string,
): boolean => {
  let previousIndex = operatorIndex - 1;
  while (previousIndex >= 0 && isASCIIWhitespace(pipeBody[previousIndex])) {
    previousIndex--;
  }
  const previousCharacter = pipeBody[previousIndex];
  const nextCharacter = pipeBody[operatorIndex + operatorNeedle.length];
  return (previousIndex < 0 || previousCharacter === ',') && !isIdentifierPart(nextCharacter);
};

const pipeBodySegment = (segment: string): string | undefined => {
  const pipeIndex = segment.indexOf('.pipe');
  if (pipeIndex === -1) {
    return undefined;
  }
  const openParenIndex = segment.indexOf('(', pipeIndex);
  if (openParenIndex === -1) {
    return undefined;
  }
  return segment.slice(openParenIndex + 1, findBalancedCallEnd(segment, openParenIndex));
};

const pipeBodyHasTopLevelOperator = (pipeBody: string, operatorNeedle: string): boolean => {
  let operatorIndex = pipeBody.indexOf(operatorNeedle);
  while (operatorIndex !== -1) {
    if (isPipeOperatorAtTopLevel(pipeBody, operatorIndex, operatorNeedle)) {
      return true;
    }
    operatorIndex = pipeBody.indexOf(operatorNeedle, operatorIndex + operatorNeedle.length);
  }
  return false;
};

/** Internal helper exported for package-local composition.
 *
 * @internal
 */
export const hasTopLevelPipeOperator = (
  segment: string,
  operatorName: 'retry' | 'timeout' | 'withSpan',
): boolean => {
  const pipeBody = pipeBodySegment(segment);
  if (!pipeBody) {
    return false;
  }
  const operatorNeedle = `Effect.${operatorName}`;
  return pipeBodyHasTopLevelOperator(pipeBody, operatorNeedle);
};
