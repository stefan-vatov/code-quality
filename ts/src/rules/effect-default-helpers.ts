import { effectImportAliases, hasRuntimeCall } from './effect-rule-core.js';
import {
  findBalancedCallEnd,
  findMatchingBrace,
  findStatementEnd,
  isInsideCall,
  sameFunctionTail,
  stripComments,
  stripCommentsAndStrings,
} from './effect-source-helpers.js';

const EFFECT_PATTERN_CACHE_MAX = 256;
const effectAliasesPatternCache = new Map<string, string>();
const effectCallPatternCache = new Map<string, Map<string, RegExp>>();
const floatingEffectPatternCache = new Map<string, FloatingEffectPatterns>();

type FloatingEffectPatterns = {
  floatingEffectCall: RegExp;
  guardedAndEffectCall: RegExp;
  guardedOrEffectCall: RegExp;
  inlineIfEffectCall: RegExp;
  ternaryEffectCall: RegExp;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setBoundedCacheValue<Value>(cache: Map<string, Value>, key: string, value: Value): Value {
  if (cache.size >= EFFECT_PATTERN_CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }
  cache.set(key, value);
  return value;
}

function effectAliasesPattern(source: string): string {
  const cachedPattern = effectAliasesPatternCache.get(source);
  if (cachedPattern !== undefined) {
    return cachedPattern;
  }

  return setBoundedCacheValue(
    effectAliasesPatternCache,
    source,
    effectImportAliases(source).map(escapeRegExp).join('|'),
  );
}

function effectCallPattern(source: string, methods: string): RegExp {
  let sourceCache = effectCallPatternCache.get(source);
  if (sourceCache === undefined) {
    sourceCache = setBoundedCacheValue(effectCallPatternCache, source, new Map<string, RegExp>());
  }

  const cachedPattern = sourceCache.get(methods);
  if (cachedPattern !== undefined) {
    return cachedPattern;
  }

  const pattern = new RegExp(`\\b(?:${effectAliasesPattern(source)})\\.(?:${methods})\\s*\\(`, 'g');
  sourceCache.set(methods, pattern);
  return pattern;
}

function floatingEffectPatterns(aliasPattern: string): FloatingEffectPatterns {
  const cachedPatterns = floatingEffectPatternCache.get(aliasPattern);
  if (cachedPatterns !== undefined) {
    return cachedPatterns;
  }

  const runtimeMethods = 'runPromise|runPromiseExit|runSync|runSyncExit|runFork';
  return setBoundedCacheValue(floatingEffectPatternCache, aliasPattern, {
    floatingEffectCall: new RegExp(
      `^(?:void\\s+)?\\(*\\s*(?:${aliasPattern})\\.(?!(?:${runtimeMethods})\\b)[A-Za-z_$][\\w$]*\\s*\\(`,
    ),
    guardedAndEffectCall: new RegExp(
      `^[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)?\\s*&&\\s*(?:${aliasPattern})\\.(?!(?:${runtimeMethods})\\b)[A-Za-z_$][\\w$]*\\s*\\(`,
    ),
    guardedOrEffectCall: new RegExp(
      `^[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)?\\s*\\|\\|\\s*(?:${aliasPattern})\\.(?!(?:${runtimeMethods})\\b)[A-Za-z_$][\\w$]*\\s*\\(`,
    ),
    inlineIfEffectCall: new RegExp(
      `^if\\s*\\([^)]*\\)\\s*(?:${aliasPattern})\\.(?!(?:${runtimeMethods})\\b)[A-Za-z_$][\\w$]*\\s*\\(`,
    ),
    ternaryEffectCall: new RegExp(
      `\\?\\s*(?:${aliasPattern})\\.(?!(?:${runtimeMethods})\\b)[A-Za-z_$][\\w$]*\\s*\\(`,
    ),
  });
}

function hasFloatingEffectCandidateLine(line: string, aliasNeedles: readonly string[]): boolean {
  if (line.includes('.pipe') || line.includes('Schema.decode')) {
    return true;
  }

  return aliasNeedles.some((needle) => line.includes(needle));
}

function hasRuntimeInEffect(source: string): boolean {
  return someEffectWorkflowBody(source, (body) => hasRuntimeCall(body));
}

function hasNestedFlatMap(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  return (
    /Effect\.flatMap\s*\([\s\S]*?=>[\s\S]*?\.pipe\s*\(\s*Effect\.flatMap/s.test(code) ||
    /Effect\.flatMap\s*\([^,]+,\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>[\s\S]*?Effect\.flatMap\s*\(/s.test(
      code,
    )
  );
}

function localCallSegment(source: string, targetIndex: number): string {
  const openParenIndex = source.indexOf('(', targetIndex);
  if (openParenIndex === -1) {
    return source.slice(targetIndex, findStatementEnd(source, targetIndex) + 1);
  }
  return source.slice(targetIndex, findBalancedCallEnd(source, openParenIndex) + 1);
}

function hasUnboundedEffectConcurrency(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\bEffect\.(?:forEach|all)\s*\(/g)) {
    if (
      /\{[\s\S]*?\bconcurrency\s*:\s*['"]unbounded['"]/.test(
        stripComments(localCallSegment(source, match.index)),
      )
    ) {
      return true;
    }
  }

  return false;
}

function hasUnboundedFlatMapConcurrency(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\bEffect\.flatMap\s*\(/g)) {
    if (
      /\{[\s\S]*?\bconcurrency\s*:\s*['"]unbounded['"]/.test(
        stripComments(localCallSegment(source, match.index)),
      )
    ) {
      return true;
    }
  }

  return false;
}

function hasParsedJsonNumberFromString(source: string): boolean {
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
}

function hasEffectInArrayForEach(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\b(?!Effect\b)[A-Za-z_$][\w$]*\.forEach\s*\(/g)) {
    const openParenIndex = source.indexOf('(', match.index);
    const callBody = source.slice(openParenIndex + 1, findBalancedCallEnd(source, openParenIndex));
    if (/(?:=>|function\b)[\s\S]*?\bEffect\./.test(stripCommentsAndStrings(callBody))) {
      return true;
    }
  }

  return false;
}

function hasEffectInPromiseCallback(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\.(?:then|catch)\s*\(/g)) {
    const openParenIndex = source.indexOf('(', match.index);
    const callBody = source.slice(openParenIndex + 1, findBalancedCallEnd(source, openParenIndex));
    if (/(?:=>|function\b)[\s\S]*?\bEffect\./.test(stripCommentsAndStrings(callBody))) {
      return true;
    }
  }

  return false;
}

function enclosingPipeBody(source: string, targetIndex: number): string | undefined {
  for (const match of source.matchAll(/\.pipe\s*\(/g)) {
    const openParenIndex = source.indexOf('(', match.index);
    if (openParenIndex === -1 || openParenIndex > targetIndex) {
      continue;
    }
    const endIndex = findBalancedCallEnd(source, openParenIndex);
    if (targetIndex <= endIndex) {
      return source.slice(openParenIndex + 1, endIndex);
    }
  }

  return undefined;
}

function effectCallBodies(source: string, callPattern: RegExp): string[] {
  const code = stripCommentsAndStrings(source);
  const bodies: string[] = [];
  for (const match of code.matchAll(callPattern)) {
    const openParenIndex = source.indexOf('(', match.index);
    if (openParenIndex === -1) {
      continue;
    }
    bodies.push(source.slice(openParenIndex + 1, findBalancedCallEnd(source, openParenIndex)));
  }

  return bodies;
}

function someEffectWorkflowBody(source: string, predicate: (body: string) => boolean): boolean {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(effectCallPattern(source, 'gen'))) {
    const openParenIndex = source.indexOf('(', match.index);
    if (openParenIndex === -1) {
      continue;
    }
    if (predicate(source.slice(openParenIndex + 1, findBalancedCallEnd(source, openParenIndex)))) {
      return true;
    }
  }

  for (const match of code.matchAll(effectCallPattern(source, 'fn'))) {
    const openParenIndex = source.indexOf('(', match.index);
    if (openParenIndex === -1) {
      continue;
    }

    const firstCallEnd = findBalancedCallEnd(source, openParenIndex);
    const nextCallMatch = /^\s*\(/.exec(source.slice(firstCallEnd + 1));
    if (!nextCallMatch) {
      if (predicate(source.slice(openParenIndex + 1, firstCallEnd))) {
        return true;
      }
      continue;
    }

    const nextOpenParenIndex = firstCallEnd + 1 + nextCallMatch[0].lastIndexOf('(');
    if (
      predicate(
        source.slice(nextOpenParenIndex + 1, findBalancedCallEnd(source, nextOpenParenIndex)),
      )
    ) {
      return true;
    }
  }

  return false;
}

function hasReturnEffectInGen(source: string): boolean {
  const returnEffectPattern = new RegExp(
    `\\breturn\\s+(?:${effectAliasesPattern(source)})\\.(?!isEffect\\b|serviceFunction\\b)`,
  );
  return effectCallBodies(source, effectCallPattern(source, 'gen')).some((body) =>
    returnEffectPattern.test(stripCommentsAndStrings(body)),
  );
}

function hasYieldWithoutStarInGen(source: string): boolean | number {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(effectCallPattern(source, 'gen'))) {
    const openParenIndex = source.indexOf('(', match.index);
    if (openParenIndex === -1) {
      continue;
    }

    const bodyStart = openParenIndex + 1;
    const body = source.slice(bodyStart, findBalancedCallEnd(source, openParenIndex));
    const bodyCode = stripCommentsAndStrings(body);
    const yieldMatch = /(?:^|[^\w$])(yield\s+(?!\*)[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)/.exec(
      bodyCode,
    );
    if (yieldMatch?.index !== undefined) {
      return bodyStart + yieldMatch.index + yieldMatch[0].indexOf(yieldMatch[1]);
    }
  }

  return false;
}

function hasAsyncAwaitInEffect(source: string): boolean {
  return someEffectWorkflowBody(source, (body) =>
    /(?:^|[({,]\s*)async\b|\bawait\b/.test(stripCommentsAndStrings(body)),
  );
}

function hasSyncForPromise(source: string): boolean {
  return effectCallBodies(source, effectCallPattern(source, 'sync')).some((body) => {
    const code = stripCommentsAndStrings(body);
    return /^\s*async\b/.test(code) || /\b(?:fetch|Promise\.)\s*\(/.test(code);
  });
}

function hasSyncForThrowingOps(source: string): boolean {
  return effectCallBodies(source, effectCallPattern(source, 'sync')).some((body) =>
    /\b(?:throw\b|JSON\.parse\s*\()/.test(stripCommentsAndStrings(body)),
  );
}

function hasThrowInEffect(source: string): boolean {
  return someEffectWorkflowBody(source, (body) => /\bthrow\b/.test(stripCommentsAndStrings(body)));
}

function hasFloatingEffect(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  const aliasNeedles = effectImportAliases(source).map((alias) => `${alias}.`);
  const aliases = effectAliasesPattern(source);
  let patterns: FloatingEffectPatterns | undefined = undefined;
  let previous = '';
  let lineStart = 0;
  while (lineStart <= code.length) {
    const newlineIndex = code.indexOf('\n', lineStart);
    const lineEnd = newlineIndex === -1 ? code.length : newlineIndex;
    const line = code.slice(lineStart, lineEnd);

    if (!hasFloatingEffectCandidateLine(line, aliasNeedles)) {
      const trimmed = line.trim();
      if (trimmed !== '') {
        previous = trimmed;
      }
      if (newlineIndex === -1) {
        break;
      }
      lineStart = newlineIndex + 1;
      continue;
    }

    const trimmed = line.trim();
    patterns ??= floatingEffectPatterns(aliases);
    if (
      patterns.floatingEffectCall.test(trimmed) &&
      !/[=(:,[]\s*$/.test(previous) &&
      !previous.endsWith('.pipe(') &&
      !trimmed.endsWith(',')
    ) {
      return true;
    }
    if (
      /^[A-Za-z_$][\w$]*\.pipe\s*\([\s\S]*?\bEffect\./.test(trimmed) &&
      !/[=(:,[]\s*$/.test(previous)
    ) {
      return true;
    }
    if (/^Schema\.decode[A-Za-z]*\s*\([^)]*\)\s*\([^)]*\)\s*;?$/.test(trimmed)) {
      return true;
    }
    if (patterns.inlineIfEffectCall.test(trimmed)) {
      return true;
    }
    if (patterns.guardedAndEffectCall.test(trimmed)) {
      return true;
    }
    if (patterns.guardedOrEffectCall.test(trimmed)) {
      return true;
    }
    if (patterns.ternaryEffectCall.test(trimmed)) {
      return true;
    }
    if (trimmed !== '') {
      previous = trimmed;
    }
    if (newlineIndex === -1) {
      break;
    }
    lineStart = newlineIndex + 1;
  }

  for (const match of code.matchAll(/^\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\.pipe\s*\(/gm)) {
    const statementPrefix = code.slice(code.lastIndexOf(';', match.index) + 1, match.index);
    if (/[=(:,[]\s*$/.test(statementPrefix.trimEnd())) {
      continue;
    }

    const openParenIndex = code.indexOf('(', match.index);
    const pipeCall = code.slice(match.index, findBalancedCallEnd(code, openParenIndex) + 1);
    if (/\bEffect\./.test(pipeCall)) {
      return true;
    }
  }

  return false;
}

function isUnobservedForkMatch(source: string, match: RegExpExecArray): boolean {
  const [, fiberName] = match;
  const lineStart = source.lastIndexOf('\n', match.index) + 1;
  const prefix = source.slice(lineStart, match.index);
  if (!fiberName && /\breturn\s+$/.test(prefix)) {
    return false;
  }
  if (!fiberName) {
    return true;
  }

  const observedFiberPattern = new RegExp(
    `(?:yield\\*\\s+Fiber\\.(?:join|interrupt)\\s*\\(\\s*${fiberName}\\b|yield\\*\\s+${fiberName}\\.await\\b)`,
  );
  return !observedFiberPattern.test(sameFunctionTail(source, match.index + match[0].length));
}

function hasUnobservedFork(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  const forkPatterns = [
    /\b(?:(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*)?yield\*\s+Effect\.fork\s*\(/g,
    /\b(?:(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*)?yield\*\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\.pipe\s*\(\s*Effect\.fork\b/g,
  ];

  for (const pattern of forkPatterns) {
    for (const match of code.matchAll(pattern)) {
      if (isUnobservedForkMatch(code, match)) {
        return true;
      }
    }
  }

  return (
    /^\s*Effect\.fork\s*\(/m.test(code) ||
    /^\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?\.pipe\s*\(\s*Effect\.fork\b/m.test(code)
  );
}

function hasRunForkWithoutObserver(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  const assignedForks = [
    ...code.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*Effect\.runFork\s*\(/g),
  ];
  for (const [index, match] of assignedForks.entries()) {
    const [, fiberName] = match;
    const nextSameNameFork = assignedForks
      .slice(index + 1)
      .find((nextMatch) => nextMatch[1] === fiberName);
    const localSource = sameFunctionTail(code, match.index).slice(
      0,
      nextSameNameFork ? nextSameNameFork.index - match.index : undefined,
    );
    const observedPattern = new RegExp(`\\b${fiberName}\\.addObserver\\b`);
    if (!observedPattern.test(localSource)) {
      return true;
    }
  }

  const unassignedSource = code.replace(
    /\b(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*Effect\.runFork\s*\(/g,
    '',
  );
  return /Effect\.runFork\s*\(/.test(unassignedSource);
}

function hasUnsafeLazyEvaluation(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(
    /Effect\.succeed\s*\(\s*(?:Date\.now|Math\.random|new\s+Date|JSON\.parse)\s*\(/g,
  )) {
    if (!isInsideCall(code, match.index, /Effect\.suspend\s*\(/g)) {
      return true;
    }
  }

  return false;
}

function hasSchemaSyncDecodeInEffectWorkflow(source: string): boolean {
  return someEffectWorkflowBody(source, (body) =>
    /Schema\.decode(?:Unknown)?Sync\s*\(/.test(stripCommentsAndStrings(body)),
  );
}

function hasSchemaPromiseDecode(source: string): boolean {
  return /Schema\.decode[A-Za-z]*Promise\s*\(/.test(stripCommentsAndStrings(source));
}

function hasTryPromiseWithoutTypedCatch(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  if (/\bEffect\.tryPromise\s*\(\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(code)) {
    return true;
  }

  for (const match of code.matchAll(/Effect\.tryPromise\s*\(\s*{/g)) {
    const objectStart = code.indexOf('{', match.index);
    const objectEnd = findMatchingBrace(code, objectStart);
    if (objectEnd === -1) {
      continue;
    }

    const body = code.slice(objectStart + 1, objectEnd);
    if (/\btry\s*:/.test(body) && !/\bcatch\s*:/.test(body)) {
      return true;
    }
    const rawBody = source.slice(objectStart + 1, objectEnd);
    const catchIndex = body.search(/\bcatch\s*:/);
    const catchTail = catchIndex === -1 ? '' : stripComments(rawBody.slice(catchIndex));
    if (
      /^\s*catch\s*:[\s\S]*?=>\s*(?:new\s+Error\s*\(|['"`])/.test(catchTail) ||
      /^\s*catch\s*:[\s\S]*?=>\s*\(\s*{(?![\s\S]*\b_tag\s*:)/.test(catchTail)
    ) {
      return true;
    }
  }

  return false;
}

function hasExternalJsonWithoutDecodeUnknown(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\b(?:response|res)\.json\s*\(\s*\)/g)) {
    const callSegment = localCallSegment(code, match.index);
    if (
      !isInsideCall(code, match.index, /Schema\.decodeUnknown\s*\(/g) &&
      !/Schema\.decodeUnknown/.test(callSegment)
    ) {
      return true;
    }
  }

  return false;
}

function hasCastAfterSchemaDecode(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/Schema\.decode[A-Za-z]*\s*\(/g)) {
    const lineStart = Math.max(
      code.lastIndexOf(';', match.index) + 1,
      code.lastIndexOf('\n', match.index) + 1,
    );
    const line = code.slice(
      lineStart,
      code.indexOf('\n', match.index) === -1 ? code.length : code.indexOf('\n', match.index),
    );
    const bindingName = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line)?.[1];
    if (/Schema\.decode[A-Za-z]*\s*\([^)]*\)\s*\([^)]*\)\s+as\s+[A-Za-z_$][\w$]*/.test(line)) {
      return true;
    }
    if (bindingName) {
      const tail = code.slice(match.index + match[0].length, match.index + match[0].length + 240);
      if (new RegExp(`\\b${bindingName}\\s+as\\s+[A-Za-z_$][\\w$]*`).test(tail)) {
        return true;
      }
    }
  }

  for (const match of code.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*Schema\.decode[A-Za-z]*\s*\([^)]*\)\s*\([^)]*\)/g,
  )) {
    const [, bindingName] = match;
    const tail = code.slice(match.index + match[0].length, match.index + match[0].length + 240);
    if (new RegExp(`\\b${bindingName}\\s+as\\s+[A-Za-z_$][\\w$]*`).test(tail)) {
      return true;
    }
  }

  return false;
}

function hasUnhandledSchemaEffectDecode(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*Schema\.decodeUnknown\s*\([^)]*\)\s*\([^)]*\)/g,
  )) {
    const [, bindingName] = match;
    const tail = code.slice(match.index + match[0].length);
    const handledPattern = new RegExp(
      `(?:yield\\*\\s+${bindingName}\\b|return\\s+${bindingName}\\b)`,
    );
    if (!handledPattern.test(tail)) {
      return true;
    }
  }

  return /Schema\.decodeUnknown\s*\([^)]*\)\s*\([^)]*\)\.pipe\s*\(\s*Effect\.(?:orDie|ignore)\b/.test(
    code,
  );
}

function hasJsonParsedBeforeSchemaStringDecode(source: string): boolean {
  return /Schema\.decode[A-Za-z]*\s*\((?![^)]*Schema\.parseJson)[\s\S]*?\)\s*\(\s*JSON\.parse\s*\(/.test(
    stripCommentsAndStrings(source),
  );
}

function hasUnsafeRecursiveBody(name: string, body: string): boolean {
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
}

function hasRecursiveEffectWithoutSuspend(source: string): boolean {
  for (const match of source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*{/g)) {
    const [, name] = match;
    const bodyStart = source.indexOf('{', match.index);
    const bodyEnd = findMatchingBrace(source, bodyStart);
    if (bodyEnd !== -1 && hasUnsafeRecursiveBody(name, source.slice(bodyStart + 1, bodyEnd))) {
      return true;
    }
  }

  for (const match of source.matchAll(
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*/g,
  )) {
    const [, name] = match;
    const bodyStart = match.index + match[0].length;
    const expressionEnd = source.indexOf(';', bodyStart);
    const body =
      source[bodyStart] === '{'
        ? source.slice(bodyStart + 1, findMatchingBrace(source, bodyStart))
        : source.slice(bodyStart, expressionEnd === -1 ? source.length : expressionEnd);
    if (hasUnsafeRecursiveBody(name, body)) {
      return true;
    }
  }

  return false;
}

function hasUnloggedIgnore(source: string): boolean {
  for (const match of source.matchAll(/\bEffect\.ignore\b/g)) {
    const pipeBody = enclosingPipeBody(source, match.index);
    const localPrefix = pipeBody
      ? pipeBody.slice(0, Math.max(0, match.index - source.indexOf(pipeBody)))
      : source.slice(Math.max(0, match.index - 160), match.index);
    if (!/\b(?:Effect\.log|tapError|tapBoth|catchAll)\b/.test(localPrefix)) {
      return true;
    }
  }

  return false;
}

function hasMultipleCatchTagsInOnePipe(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\.pipe\s*\(/g)) {
    const openParenIndex = source.indexOf('(', match.index);
    if (openParenIndex === -1) {
      continue;
    }
    const pipeBody = source.slice(match.index, findBalancedCallEnd(source, openParenIndex) + 1);
    const catchTagCount = [...pipeBody.matchAll(/Effect\.catchTag\s*\(/g)].length;
    if (catchTagCount > 1 && !/Effect\.catchTags\s*\(/.test(pipeBody)) {
      return true;
    }
  }

  return false;
}

function hasBroadCatchAllWithoutRethrow(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/Effect\.catchAll\s*\(/g)) {
    const openParenIndex = source.indexOf('(', match.index);
    if (openParenIndex === -1) {
      continue;
    }
    const callBody = source.slice(openParenIndex + 1, findBalancedCallEnd(source, openParenIndex));
    if (!/=>\s*Effect\.fail\s*\(/.test(callBody)) {
      return true;
    }
  }

  return false;
}

function hasErrorMappingWithoutCause(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/(?:mapError|catchAll)\s*\(/g)) {
    const openParenIndex = source.indexOf('(', match.index);
    if (openParenIndex === -1) {
      continue;
    }
    const callBody = source.slice(openParenIndex + 1, findBalancedCallEnd(source, openParenIndex));
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
  }

  return false;
}

function hasForkDaemonWithoutCleanup(source: string): boolean {
  return effectCallBodies(source, /\bEffect\.forkDaemon\s*\(/g).some(
    (body) =>
      !/\b(?:Effect\.)?(?:ensuring|onExit|onInterrupt|supervised)\b|Supervisor\./.test(body),
  );
}

function hasForkInUninterruptibleWithoutRestore(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\bEffect\.uninterruptible\s*\(/g)) {
    const openParenIndex = source.indexOf('(', match.index);
    const callBody = source.slice(openParenIndex + 1, findBalancedCallEnd(source, openParenIndex));
    if (/\bEffect\.fork\b/.test(callBody) && !/\brestore\s*\(/.test(callBody)) {
      return true;
    }
  }

  return false;
}

export {
  hasAsyncAwaitInEffect,
  hasEffectInArrayForEach,
  hasEffectInPromiseCallback,
  hasErrorMappingWithoutCause,
  hasFloatingEffect,
  hasForkDaemonWithoutCleanup,
  hasForkInUninterruptibleWithoutRestore,
  hasBroadCatchAllWithoutRethrow,
  hasJsonParsedBeforeSchemaStringDecode,
  hasMultipleCatchTagsInOnePipe,
  hasNestedFlatMap,
  hasRecursiveEffectWithoutSuspend,
  hasReturnEffectInGen,
  hasRunForkWithoutObserver,
  hasRuntimeInEffect,
  hasSchemaPromiseDecode,
  hasSchemaSyncDecodeInEffectWorkflow,
  hasSyncForPromise,
  hasSyncForThrowingOps,
  hasTryPromiseWithoutTypedCatch,
  hasUnhandledSchemaEffectDecode,
  hasParsedJsonNumberFromString,
  hasCastAfterSchemaDecode,
  hasExternalJsonWithoutDecodeUnknown,
  hasUnloggedIgnore,
  hasUnboundedEffectConcurrency,
  hasUnboundedFlatMapConcurrency,
  hasUnobservedFork,
  hasThrowInEffect,
  hasUnsafeLazyEvaluation,
  hasYieldWithoutStarInGen,
};
