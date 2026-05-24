import { hasEffectSignal } from './effect-rule-core.js';
import {
  findBalancedCallEnd,
  findStatementEnd,
  isInsideCall,
  stripComments,
  stripCommentsAndStrings,
} from './effect-source-helpers.js';

const SEGMENT_CACHE_MAX = 256;
const EXTERNAL_CALL_PATTERN =
  /\b(?:HttpClient\.(?:get|post|put|patch|delete|request)|fetch|FileSystem\.[A-Za-z_$][\w$]*|SqlClient\.[A-Za-z_$][\w$]*)\s*\(/g;
const IDEMPOTENT_EXTERNAL_CALL_PATTERN =
  /\b(?:HttpClient\.(?:get|head|put|delete)|fetch|(?:find|lookup|read)[A-Z]\w*)\s*\(/g;
const localEffectCallSegmentCache = new Map<string, Map<number, string>>();
const enclosingEffectWrapperSegmentCache = new Map<string, Map<number, string | undefined>>();

function sourceIndexCache<Value>(
  cache: Map<string, Map<number, Value>>,
  source: string,
): Map<number, Value> {
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
}

function lineAround(source: string, targetIndex: number): string {
  const start = source.lastIndexOf('\n', targetIndex) + 1;
  const end = source.indexOf('\n', targetIndex);
  return source.slice(start, end === -1 ? source.length : end);
}

function isAsciiWhitespace(character: string | undefined): boolean {
  return character === ' ' || character === '\n' || character === '\r' || character === '\t';
}

function isIdentifierPart(character: string | undefined): boolean {
  if (character === undefined || character === '$' || character === '_') {
    return character !== undefined;
  }

  const charCode = character.charCodeAt(0);
  return (
    (charCode >= 48 && charCode <= 57) ||
    (charCode >= 65 && charCode <= 90) ||
    (charCode >= 97 && charCode <= 122)
  );
}

function testSegments(source: string): string[] {
  if (!source.includes('it(') && !source.includes('it.effect')) {
    return [source];
  }

  const code = stripCommentsAndStrings(source);
  const starts = [...code.matchAll(/\bit(?:\.effect)?\s*\(/g)].map((match) => match.index);
  if (starts.length === 0) {
    return [code];
  }

  return starts.map((start, index) => code.slice(start, starts[index + 1] ?? code.length));
}

function hasLayerFactory(source: string): boolean {
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
}

function hasUnscopedResourceLayer(source: string): boolean {
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
}

function hasBoundaryDataWithoutSchema(source: string): boolean {
  if (
    !source.includes('.body') &&
    !source.includes('.params') &&
    !source.includes('.query') &&
    !source.includes('.payload')
  ) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(
    /(?:req|request|command|message)\.(?:body|params|query|payload)/g,
  )) {
    const accessEnd = match.index + match[0].length;
    const tail = code.slice(accessEnd);
    const pipeMatch = /^\s*\.pipe\s*\(/.exec(tail);
    const segment = pipeMatch
      ? code.slice(match.index, accessEnd + findBalancedCallEnd(tail, tail.indexOf('(')) + 1)
      : code.slice(match.index, accessEnd);
    if (
      !isInsideCall(code, match.index, /Schema\.decode[A-Za-z]*\s*\(/g) &&
      !/Schema\.decode/.test(segment)
    ) {
      return true;
    }
  }

  return false;
}

function hasHttpServerRequestWithoutSchema(source: string): boolean {
  if (!source.includes('HttpRouter.') && !source.includes('HttpServerRequest')) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  if (!/\b(?:HttpRouter\.|HttpServerRequest\b)/.test(code)) {
    return false;
  }

  for (const match of code.matchAll(/\b(?:body|Body|json|Json|urlParams)\b/g)) {
    const line = lineAround(code, match.index);
    const bindingName = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\b/.exec(line)?.[1];
    const tail = code.slice(match.index, findStatementEnd(code, match.index) + 240);
    if (
      !/Schema\.decode/.test(line) &&
      !(
        bindingName &&
        new RegExp(`Schema\\.decode[A-Za-z]*\\s*\\([^)]*\\)\\s*\\(\\s*${bindingName}\\b`).test(tail)
      )
    ) {
      return true;
    }
  }

  return false;
}

function hasPersistenceReadWithoutSchema(source: string): boolean {
  if (
    !source.includes('db.') &&
    !source.includes('database.') &&
    !source.includes('collection.') &&
    !source.includes('repository.')
  ) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(
    /\b(?:db|database|collection|repository)\.[\s\S]*?(?:select|find|get|query)\s*\(/g,
  )) {
    const localSource = lineAround(code, match.index);
    const bindingName = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\b/.exec(localSource)?.[1];
    const tail = code.slice(match.index, findStatementEnd(code, match.index) + 240);
    if (
      !/Schema\.decode/.test(localSource) &&
      !(
        bindingName &&
        new RegExp(`Schema\\.decode[A-Za-z]*\\s*\\([^)]*\\)\\s*\\(\\s*${bindingName}\\b`).test(tail)
      )
    ) {
      return true;
    }
  }

  return false;
}

function hasCommandHandlerWithoutSchema(source: string): boolean {
  if (
    !source.includes('handler') ||
    (!source.includes('Command') &&
      !source.includes('Cli') &&
      !source.includes('Job') &&
      !source.includes('Message'))
  ) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\b(?:Command|Cli|Job|Message)\b[\s\S]*?handler/g)) {
    const localSource = code.slice(Math.max(0, match.index - 160), match.index + 160);
    if (!/(?:Schema\.|schema\s*:)/.test(localSource)) {
      return true;
    }
  }

  return false;
}

function hasUnscopedResourceLoop(source: string): boolean {
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
    const prefix = code.slice(Math.max(0, match.index - 180), match.index);
    if (
      /\b(?:for|while)\b/.test(prefix) &&
      !isInsideCall(code, match.index, /Effect\.scoped\s*\(/g)
    ) {
      return true;
    }
  }

  return false;
}

function hasUnsafeResourceStream(source: string): boolean {
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
    const prefix = code.slice(Math.max(0, match.index - 180), match.index);
    if (
      /\bStream\./.test(prefix) &&
      !isInsideCall(code, match.index, /(?:Stream|Effect)\.scoped\s*\(/g)
    ) {
      return true;
    }
  }

  return false;
}

function hasLiveTestService(source: string): boolean {
  if (!source.includes('Live') && !source.includes('Layer.live')) {
    return false;
  }

  return /(?:\bLive\b|[A-Za-z_$][\w$]*Live\b|Layer\.live)/.test(stripCommentsAndStrings(source));
}

function hasRealTestService(source: string): boolean {
  if (!source.includes('real')) {
    return false;
  }

  return /\breal[A-Z]/.test(stripCommentsAndStrings(source));
}

function hasDuplicateLayerInstance(source: string): boolean {
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
}

function localEffectCallSegment(source: string, targetIndex: number): string {
  const indexCache = sourceIndexCache(localEffectCallSegmentCache, source);
  const cachedSegment = indexCache.get(targetIndex);
  if (cachedSegment !== undefined) {
    return cachedSegment;
  }

  const openParenIndex = source.indexOf('(', targetIndex);
  if (openParenIndex === -1) {
    const segment = source.slice(targetIndex, targetIndex + 160);
    indexCache.set(targetIndex, segment);
    return segment;
  }

  let endIndex = findBalancedCallEnd(source, openParenIndex) + 1;
  const afterCall = source.slice(endIndex);
  const pipeMatch = afterCall.match(/^\s*\.pipe\s*\(/);
  if (pipeMatch) {
    const pipeOpenIndex = endIndex + pipeMatch[0].lastIndexOf('(');
    endIndex = findBalancedCallEnd(source, pipeOpenIndex) + 1;
  }

  const segment = source.slice(targetIndex, endIndex);
  indexCache.set(targetIndex, segment);
  return segment;
}

function localStatementSegment(source: string, targetIndex: number): string {
  return source.slice(targetIndex, findStatementEnd(source, targetIndex) + 1);
}

function hasOutputBoundaryWithoutSchema(source: string): boolean {
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
}

function hasHttpClientResponseWithoutSchema(source: string): boolean {
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
}

function hasSharedResourceForEachWithoutSemaphore(source: string): boolean {
  if (!source.includes('Effect.forEach')) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\bEffect\.forEach\s*\(/g)) {
    const localStart = Math.max(0, match.index - 180);
    const segment = code.slice(localStart, findStatementEnd(code, match.index) + 1);
    if (
      /\b(?:pool|connection|client|browser|worker)\b/.test(segment) &&
      !/\bSemaphore\b/.test(segment)
    ) {
      return true;
    }
  }

  return false;
}

function hasEnsuringCleanupWithoutOnExit(source: string): boolean {
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
}

function hasUnterminatedLongRunningStream(source: string): boolean {
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
}

function hasAsyncPushWithoutBuffer(source: string): boolean {
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
}

function hasUnbatchedResolver(source: string): boolean {
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
}

function hasNPlusOneWithoutBatchedResolver(source: string): boolean {
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
}

function enclosingEffectWrapperSegment(source: string, targetIndex: number): string | undefined {
  const indexCache = sourceIndexCache(enclosingEffectWrapperSegmentCache, source);
  if (indexCache.has(targetIndex)) {
    return indexCache.get(targetIndex);
  }

  if (!source.includes('Effect.promise') && !source.includes('Effect.tryPromise')) {
    indexCache.set(targetIndex, undefined);
    return undefined;
  }

  for (const match of source.matchAll(/\bEffect\.(?:promise|tryPromise)\s*\(/g)) {
    const openParenIndex = source.indexOf('(', match.index);
    if (openParenIndex === -1 || openParenIndex > targetIndex) {
      continue;
    }
    const endIndex = findBalancedCallEnd(source, openParenIndex);
    if (targetIndex <= endIndex) {
      const segment = localEffectCallSegment(source, match.index);
      indexCache.set(targetIndex, segment);
      return segment;
    }
  }

  indexCache.set(targetIndex, undefined);
  return undefined;
}

function hasTopLevelPipeOperator(
  segment: string,
  operatorName: 'retry' | 'timeout' | 'withSpan',
): boolean {
  const pipeIndex = segment.indexOf('.pipe');
  if (pipeIndex === -1) {
    return false;
  }

  const openParenIndex = segment.indexOf('(', pipeIndex);
  if (openParenIndex === -1) {
    return false;
  }

  const pipeBody = segment.slice(openParenIndex + 1, findBalancedCallEnd(segment, openParenIndex));
  const operatorNeedle = `Effect.${operatorName}`;
  let operatorIndex = pipeBody.indexOf(operatorNeedle);
  while (operatorIndex !== -1) {
    let previousIndex = operatorIndex - 1;
    while (previousIndex >= 0 && isAsciiWhitespace(pipeBody[previousIndex])) {
      previousIndex--;
    }
    const previousCharacter = pipeBody[previousIndex];
    const nextCharacter = pipeBody[operatorIndex + operatorNeedle.length];
    if ((previousIndex < 0 || previousCharacter === ',') && !isIdentifierPart(nextCharacter)) {
      return true;
    }
    operatorIndex = pipeBody.indexOf(operatorNeedle, operatorIndex + operatorNeedle.length);
  }

  return false;
}

function hasExternalEffectWithoutTimeout(
  source: string,
  options: { allowFetch: boolean } = { allowFetch: true },
): boolean {
  if (
    !source.includes('HttpClient.') &&
    !source.includes('fetch') &&
    !source.includes('FileSystem.') &&
    !source.includes('SqlClient.')
  ) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(EXTERNAL_CALL_PATTERN)) {
    const enclosingWrapper = enclosingEffectWrapperSegment(code, match.index);
    if (match[0].startsWith('fetch') && (!enclosingWrapper || !options.allowFetch)) {
      continue;
    }
    const segment = enclosingWrapper ?? localEffectCallSegment(code, match.index);
    if (
      !isInsideCall(code, match.index, /Effect\.timeout\s*\(/g) &&
      !hasTopLevelPipeOperator(segment, 'timeout')
    ) {
      return true;
    }
  }

  return false;
}

function hasExternalEffectWithoutSpan(
  source: string,
  options: { allowFetch: boolean } = { allowFetch: true },
): boolean {
  if (
    !source.includes('HttpClient.') &&
    !source.includes('fetch') &&
    !source.includes('FileSystem.') &&
    !source.includes('SqlClient.')
  ) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(EXTERNAL_CALL_PATTERN)) {
    const enclosingWrapper = enclosingEffectWrapperSegment(source, match.index);
    if (match[0].startsWith('fetch') && (!enclosingWrapper || !options.allowFetch)) {
      continue;
    }
    const segment = enclosingWrapper ?? localEffectCallSegment(source, match.index);
    if (
      !isInsideCall(source, match.index, /Effect\.withSpan\s*\(/g) &&
      !hasTopLevelPipeOperator(segment, 'withSpan')
    ) {
      return true;
    }
  }

  return false;
}

function hasIdempotentExternalEffectWithoutRetry(
  source: string,
  options: { allowFetch: boolean } = { allowFetch: true },
): boolean {
  if (
    !source.includes('HttpClient.') &&
    !source.includes('fetch') &&
    !source.includes('find') &&
    !source.includes('lookup') &&
    !source.includes('read')
  ) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(IDEMPOTENT_EXTERNAL_CALL_PATTERN)) {
    const enclosingWrapper = enclosingEffectWrapperSegment(code, match.index);
    const rawEnclosingWrapper = enclosingEffectWrapperSegment(source, match.index);
    if (match[0].startsWith('fetch') && (!enclosingWrapper || !options.allowFetch)) {
      continue;
    }
    const segment = enclosingWrapper ?? localEffectCallSegment(code, match.index);
    const rawSegment = rawEnclosingWrapper ?? localEffectCallSegment(source, match.index);
    if (
      match[0].startsWith('fetch') &&
      /\bmethod\s*:\s*['"](?!(?:GET|HEAD|PUT|DELETE)['"])/.test(stripComments(rawSegment))
    ) {
      continue;
    }
    if (
      !isInsideCall(code, match.index, /Effect\.retry\s*\(/g) &&
      !hasTopLevelPipeOperator(segment, 'retry')
    ) {
      return true;
    }
  }

  return false;
}

function hasUnprovidedServiceInEffectTest(source: string): boolean {
  if (!source.includes('Service') && !source.includes('Repo') && !source.includes('Client')) {
    return false;
  }

  return testSegments(source).some(
    (segment) =>
      /yield\*\s+[A-Z][\w$]*(?:Service|Repo|Client)\b/.test(segment) &&
      !/\b(?:Effect\.)?provide[A-Za-z_$]*\s*\(/.test(segment),
  );
}

function hasTimeCodeWithoutTestClock(source: string): boolean {
  if (
    !source.includes('Effect.timeout') &&
    !source.includes('Effect.delay') &&
    !source.includes('Clock.')
  ) {
    return false;
  }

  return testSegments(source).some(
    (segment) => /Effect\.(?:timeout|delay)|Clock\./.test(segment) && !/TestClock/.test(segment),
  );
}

function hasMutableStateWithoutRef(source: string): boolean {
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
}

const hasSharedMutableStateWithoutRef = hasMutableStateWithoutRef;

export {
  hasAsyncPushWithoutBuffer,
  hasBoundaryDataWithoutSchema,
  hasCommandHandlerWithoutSchema,
  hasDuplicateLayerInstance,
  hasEnsuringCleanupWithoutOnExit,
  hasExternalEffectWithoutTimeout,
  hasExternalEffectWithoutSpan,
  hasHttpClientResponseWithoutSchema,
  hasHttpServerRequestWithoutSchema,
  hasIdempotentExternalEffectWithoutRetry,
  hasLayerFactory,
  hasLiveTestService,
  hasMutableStateWithoutRef,
  hasNPlusOneWithoutBatchedResolver,
  hasOutputBoundaryWithoutSchema,
  hasPersistenceReadWithoutSchema,
  hasRealTestService,
  hasSharedResourceForEachWithoutSemaphore,
  hasSharedMutableStateWithoutRef,
  hasTimeCodeWithoutTestClock,
  hasUnbatchedResolver,
  hasUnprovidedServiceInEffectTest,
  hasUnscopedResourceLayer,
  hasUnscopedResourceLoop,
  hasUnsafeResourceStream,
  hasUnterminatedLongRunningStream,
};
