import {
  hasBroadCatchAllWithoutRethrow,
  hasEffectInArrayForEach,
  hasEffectInPromiseCallback,
  hasForkDaemonWithoutCleanup,
  hasForkInUninterruptibleWithoutRestore,
  hasErrorMappingWithoutCause,
  hasCastAfterSchemaDecode,
  hasExternalJsonWithoutDecodeUnknown,
  hasFloatingEffect,
  hasJsonParsedBeforeSchemaStringDecode,
  hasMultipleCatchTagsInOnePipe,
  hasNestedFlatMap,
  hasParsedJsonNumberFromString,
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
  hasUnboundedEffectConcurrency,
  hasUnboundedFlatMapConcurrency,
  hasUnloggedIgnore,
  hasUnobservedFork,
  hasAsyncAwaitInEffect,
  hasThrowInEffect,
  hasUnsafeLazyEvaluation,
  hasYieldWithoutStarInGen,
} from './effect-default-helpers.js';
import {
  hasUnreleasedAcquire,
  hasUnscopedAcquireRelease,
  hasUnscopedResourceWorkflow,
} from './effect-default-resource-helpers.js';
import {
  hasForkBeforeTestClockAdjust,
  hasRealSleepWithoutTestClock,
  hasTestClockWithoutEffectContext,
} from './effect-default-test-helpers.js';
import {
  isConfiguredPath,
  isEffectTestPath,
  strictPathOptionsSchema,
} from './effect-path-options.js';
import {
  effectImportAliases,
  effectFunctionAliases,
  hasEffectSignal,
  hasRuntimeCall,
  makeRules,
} from './effect-rule-core.js';
import {
  exportedCallableDeclarationSegments,
  exportedDeclarationSegments,
  findBalancedCallEnd,
  stripCommentsAndStrings,
} from './effect-source-helpers.js';

type RuleSpec = Parameters<typeof makeRules>[0][number];
type RuleContext = Parameters<NonNullable<RuleSpec['check']>>[1];
type AstNode = Record<string, unknown>;

function reportAst(context: RuleContext, message: string, node: object): void {
  context.report({ message, node });
}

function nodeType(node: unknown): string | undefined {
  return typeof node === 'object' && node !== null ? (node as { type?: string }).type : undefined;
}

function identifierName(node: unknown): string | undefined {
  return nodeType(node) === 'Identifier' ? (node as { name?: string }).name : undefined;
}

function literalValue(node: unknown): unknown {
  return nodeType(node) === 'Literal' ? (node as { value?: unknown }).value : undefined;
}

function isStringLikeLiteral(node: unknown): boolean {
  if (typeof literalValue(node) === 'string') {
    return true;
  }
  if (nodeType(node) !== 'TemplateLiteral') {
    return false;
  }
  const { expressions } = node as { expressions?: unknown[] };
  return expressions?.length === 0;
}

function memberParts(node: unknown): { objectName?: string; propertyName?: string } {
  if (nodeType(node) !== 'MemberExpression') {
    return {};
  }
  const member = node as { object?: unknown; property?: unknown };
  return {
    objectName: identifierName(member.object),
    propertyName: identifierName(member.property),
  };
}

function isEffectMember(node: unknown, source: string, methods: ReadonlySet<string>): boolean {
  const { objectName, propertyName } = memberParts(node);
  return Boolean(
    objectName &&
    propertyName &&
    effectImportAliases(source).includes(objectName) &&
    methods.has(propertyName),
  );
}

function isEffectFunctionCall(
  callee: unknown,
  source: string,
  names: ReadonlySet<string>,
): boolean {
  const calleeName = identifierName(callee);
  return Boolean(
    calleeName &&
    [...names].some((name) => effectFunctionAliases(source, 'Effect', name).includes(calleeName)),
  );
}

function propertyKeyName(node: unknown): string | undefined {
  const value = literalValue(node);
  return identifierName(node) ?? (typeof value === 'string' ? value : undefined);
}

function typeReferenceName(node: unknown): string | undefined {
  if (nodeType(node) !== 'TSTypeReference') {
    return undefined;
  }
  const { typeName } = node as { typeName?: unknown };
  if (nodeType(typeName) === 'Identifier') {
    return identifierName(typeName);
  }
  if (nodeType(typeName) !== 'TSQualifiedName') {
    return undefined;
  }
  const qualified = typeName as { left?: unknown; right?: unknown };
  const leftName = identifierName(qualified.left);
  const rightName = identifierName(qualified.right);
  return leftName && rightName ? `${leftName}.${rightName}` : undefined;
}

function firstTypeArgumentName(node: unknown): string | undefined {
  const params = (node as { typeArguments?: { params?: unknown[] } }).typeArguments?.params;
  return typeReferenceName(params?.[0]);
}

function effectServiceSelfName(superClass: unknown, source: string): string | undefined {
  if (nodeType(superClass) !== 'CallExpression') {
    return undefined;
  }
  const outer = superClass as { callee?: unknown; typeArguments?: { params?: unknown[] } };
  const outerSelf = typeReferenceName(outer.typeArguments?.params?.[0]);
  const inner = outer.callee;
  if (nodeType(inner) !== 'CallExpression') {
    return undefined;
  }
  const innerCall = inner as { callee?: unknown };
  const { objectName, propertyName } = memberParts(innerCall.callee);
  if (objectName === 'Context' && propertyName === 'Tag') {
    return outerSelf;
  }
  if (
    objectName &&
    propertyName === 'Service' &&
    effectImportAliases(source).includes(objectName)
  ) {
    return firstTypeArgumentName(inner);
  }
  return undefined;
}

function hasMixedEffectImportStyles(source: string): boolean {
  const hasNamedRootEffectImport = /import\s*{[^}]*\bEffect\b[^}]*}\s*from\s*['"]effect['"]/.test(
    source,
  );
  const hasNamespaceEffectImport =
    /import\s+\*\s+as\s+[A-Za-z_$][\w$]*\s+from\s*['"]effect(?:\/Effect)?['"]/.test(source);

  return hasNamedRootEffectImport && hasNamespaceEffectImport;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasTryCatchInEffectGen(source: string): number | false {
  const code = stripCommentsAndStrings(source);
  const aliases = effectImportAliases(source).map(escapeRegExp).join('|');
  if (!aliases) {
    return false;
  }

  for (const match of code.matchAll(new RegExp(`\\b(?:${aliases})\\.gen\\s*\\(`, 'g'))) {
    const openParenIndex = code.indexOf('(', match.index);
    if (openParenIndex === -1) {
      continue;
    }
    const bodyStart = openParenIndex + 1;
    const body = code.slice(bodyStart, findBalancedCallEnd(code, openParenIndex));
    const tryCatchMatch = /\btry\s*{[\s\S]*?\bcatch\s*\(/.exec(body);
    if (tryCatchMatch?.index !== undefined) {
      return bodyStart + tryCatchMatch.index;
    }
  }

  return false;
}

function hasStringErrorFailure(source: string): number | false {
  const match = /\bEffect\.fail\s*\(\s*["'`]/.exec(stripCommentsAndStrings(source));
  return match?.index ?? false;
}

function hasUntaggedErrorFailure(source: string): number | false {
  const code = stripCommentsAndStrings(source);
  const nativeErrorMatch = /\bEffect\.fail\s*\(\s*new\s+Error\s*\(/.exec(code);
  if (nativeErrorMatch) {
    return nativeErrorMatch.index;
  }

  const objectErrorMatch = /\bEffect\.fail\s*\(\s*{(?![^}]*\b_tag\s*:)/.exec(code);
  return objectErrorMatch?.index ?? false;
}

function hasNativeErrorClassInEffectModule(source: string): number | false {
  if (!hasEffectSignal(source)) {
    return false;
  }

  const match = /\bclass\s+[A-Z][\w$]*\s+extends\s+Error\b/.exec(stripCommentsAndStrings(source));
  return match?.index ?? false;
}

function hasUnsafeEffectTypeAssertion(source: string): number | false {
  const code = stripCommentsAndStrings(source);
  const match = /\bas\s+Effect\.Effect\s*<[^>]*>/.exec(code);
  return match?.index ?? false;
}

function hasServiceSelfMismatch(source: string): number | false {
  const code = stripCommentsAndStrings(source);
  const legacyPattern =
    /\bclass\s+([A-Z][\w$]*)\s+extends\s+(?:Context\.Tag|Effect\.Service|Effect\.Tag)\s*\([^)]*\)\s*<\s*([A-Z][\w$]*)\b/g;
  for (const match of code.matchAll(legacyPattern)) {
    const [, className, selfName] = match;
    if (className !== selfName) {
      return match.index;
    }
  }

  const servicePattern =
    /\bclass\s+([A-Z][\w$]*)\s+extends\s+Effect\.Service\s*<\s*([A-Z][\w$]*)\s*>\s*\(\s*\)/g;
  for (const match of code.matchAll(servicePattern)) {
    const [, className, selfName] = match;
    if (className !== selfName) {
      return match.index;
    }
  }

  return false;
}

function hasEffectFnIife(source: string): number | false {
  const code = stripCommentsAndStrings(source);
  const match = /\bEffect\.fn(?:Untraced|UntracedEager)?\s*\([\s\S]*?\)\s*\([\s\S]*?\)\s*\(/.exec(
    code,
  );
  return match?.index ?? false;
}

const effectDefaultSpecs = [
  {
    name: 'effect-no-floating-effect',
    message: 'Return, yield, assign, or compose Effect values; bare Effect calls never execute.',
    check: hasFloatingEffect,
  },
  {
    name: 'effect-require-yield-star',
    message: 'Use yield* inside Effect.gen so generator composition unwraps the Effect value.',
    check: hasYieldWithoutStarInGen,
  },
  {
    name: 'effect-require-return-yield-star',
    message: 'Do not return an Effect from Effect.gen; return a value or return yield* the Effect.',
    check: hasReturnEffectInGen,
  },
  {
    name: 'effect-prefer-gen-for-nested-flatmap',
    message: 'Replace nested Effect.flatMap callbacks with Effect.gen for readable sequencing.',
    check: hasNestedFlatMap,
  },
  {
    name: 'effect-no-function-returning-gen',
    message: 'Use Effect.fn for exported effectful functions instead of returning Effect.gen.',
    check: (source) =>
      exportedCallableDeclarationSegments(source).some((segment) =>
        /(?:^|\breturn\s+)Effect\.gen\s*\(/.test(segment.trim()),
      ),
  },
  {
    name: 'effect-prefer-effect-fn-for-exported-effects',
    message: 'Exported effectful functions should use Effect.fn for tracing and stable contracts.',
    check: (source) =>
      exportedCallableDeclarationSegments(source).some((segment) =>
        /(?:^|\breturn\s+)Effect\.(?!fn\b|gen\b|isEffect\b|serviceFunction\b|runPromise\b)/.test(
          segment.trim(),
        ),
      ),
  },
  {
    name: 'effect-no-unnecessary-gen',
    message: 'Do not wrap a single Effect in Effect.gen when direct composition is clearer.',
    patterns: [/Effect\.gen\s*\(\s*function\*\s*\([^)]*\)\s*{\s*return\s+yield\*\s+Effect\./],
  },
  {
    name: 'effect-no-effect-in-array-foreach',
    message: 'Use Effect.forEach instead of Array.forEach with Effect-returning callbacks.',
    check: hasEffectInArrayForEach,
  },
  {
    name: 'effect-no-effect-in-promise-callback',
    message:
      'Do not create Effect values inside Promise callbacks; compose at the Effect boundary.',
    check: hasEffectInPromiseCallback,
  },
  {
    name: 'effect-no-floating-fiber',
    message: 'Forked fibers must be joined, interrupted, scoped, supervised, or returned.',
    check: hasUnobservedFork,
  },
  {
    name: 'effect-require-suspend-for-recursion',
    message: 'Recursive Effect construction must be wrapped in Effect.suspend.',
    check: hasRecursiveEffectWithoutSuspend,
  },
  {
    name: 'effect-require-suspend-for-lazy-evaluation',
    message: 'Use Effect.suspend when Effect construction must defer eager JavaScript work.',
    check: hasUnsafeLazyEvaluation,
  },
  {
    name: 'effect-no-async-await-in-effect',
    message:
      'Use Effect.tryPromise or Effect.promise boundaries instead of async/await in Effect code.',
    check: hasAsyncAwaitInEffect,
  },
  {
    name: 'effect-no-promise-then-in-effect',
    message: 'Use Effect combinators instead of Promise then/catch chains in Effect modules.',
    ast: (context, source) => ({
      CallExpression(node) {
        if (!hasEffectSignal(source)) {
          return;
        }
        const { callee } = node as AstNode;
        const { propertyName } = memberParts(callee);
        if (propertyName === 'then' || propertyName === 'catch') {
          reportAst(
            context,
            'Use Effect combinators instead of Promise then/catch chains in Effect modules.',
            node,
          );
        }
      },
    }),
  },
  {
    name: 'effect-no-throw',
    message: 'Use typed Effect failures instead of throw inside Effect workflows.',
    check: hasThrowInEffect,
  },
  {
    name: 'effect-no-string-errors',
    message: 'Use structured tagged errors instead of string failures.',
    check: hasStringErrorFailure,
    ast: (context, source) => ({
      CallExpression(node) {
        const call = node as { arguments?: unknown[]; callee?: unknown };
        if (
          (isEffectMember(call.callee, source, new Set(['fail'])) ||
            isEffectFunctionCall(call.callee, source, new Set(['fail']))) &&
          isStringLikeLiteral(call.arguments?.[0])
        ) {
          reportAst(context, 'Use structured tagged errors instead of string failures.', node);
        }
      },
    }),
  },
  {
    name: 'effect-no-untagged-errors',
    message: 'Use tagged/data/schema errors in Effect.fail instead of global Error values.',
    check: hasUntaggedErrorFailure,
    ast: (context, source) => ({
      CallExpression(node) {
        const call = node as { arguments?: unknown[]; callee?: unknown };
        const firstArg = call.arguments?.[0] as AstNode | undefined;
        if (
          !isEffectMember(call.callee, source, new Set(['fail'])) &&
          !isEffectFunctionCall(call.callee, source, new Set(['fail']))
        ) {
          return;
        }
        if (!firstArg) {
          return;
        }
        if (nodeType(firstArg) === 'NewExpression' && identifierName(firstArg.callee) === 'Error') {
          reportAst(
            context,
            'Use tagged/data/schema errors in Effect.fail instead of global Error values.',
            node,
          );
          return;
        }
        if (
          nodeType(firstArg) === 'ObjectExpression' &&
          !(firstArg.properties as unknown[] | undefined)?.some(
            (property) => propertyKeyName((property as { key?: unknown }).key) === '_tag',
          )
        ) {
          reportAst(
            context,
            'Use tagged/data/schema errors in Effect.fail instead of global Error values.',
            node,
          );
        }
      },
    }),
  },
  {
    name: 'effect-no-silent-error-swallowing',
    message:
      'Do not erase Effect failures without recovery, logging, or explicit typed replacement.',
    patterns: [
      /Effect\.(?:catchAll|ignore)\s*\([\s\S]*?(?:Effect\.void|Effect\.succeed\s*\(\s*undefined|undefined)/,
    ],
  },
  {
    name: 'effect-require-typed-error-in-trypromise',
    message:
      'Use Effect.tryPromise({ try, catch }) so Promise failures become typed Effect errors.',
    check: hasTryPromiseWithoutTypedCatch,
  },
  {
    name: 'effect-prefer-catchTag-over-catchAll',
    message: 'Prefer catchTag or catchTags over broad catchAll recovery.',
    check: hasBroadCatchAllWithoutRethrow,
  },
  {
    name: 'effect-no-catchAll-with-mapError',
    message: 'Use mapError directly instead of catchAll when only transforming the error.',
    patterns: [/Effect\.catchAll\s*\([\s\S]*?=>\s*Effect\.fail\s*\(/],
  },
  {
    name: 'effect-prefer-mapError-over-catchAll-rethrow',
    message: 'Use Effect.mapError instead of catchAll followed by fail.',
    patterns: [/(?:^|[^\w$.])catchAll\s*\([\s\S]*?=>\s*Effect\.fail\s*\(/],
  },
  {
    name: 'effect-require-error-cause-preserved',
    message: 'Preserve the original cause when mapping or wrapping Effect errors.',
    check: hasErrorMappingWithoutCause,
  },
  {
    name: 'effect-prefer-ignore-logged',
    message: 'Ignored Effect failures must be logged or otherwise observable.',
    check: hasUnloggedIgnore,
  },
  {
    name: 'effect-prefer-catchTags-for-multiple-tags',
    message: 'Use Effect.catchTags for multiple tagged Effect recoveries.',
    check: hasMultipleCatchTagsInOnePipe,
  },
  {
    name: 'effect-no-error-channel-widening-to-unknown',
    message: 'Do not widen Effect error channels to unknown.',
    patterns: [/Effect\s*<[^>]*,\s*unknown\b/, /Effect\.fail\s*<\s*unknown\b/],
  },
  {
    name: 'effect-no-run-inside-effect',
    message: 'Do not run an Effect from inside another Effect; yield or compose it instead.',
    check: hasRuntimeInEffect,
  },
  {
    name: 'effect-no-runpromise-in-exported-api',
    message:
      'Exported APIs should expose Effect values instead of hiding execution behind Promise.',
    check: (source) =>
      exportedDeclarationSegments(source).some((segment) =>
        /Effect\.runPromise\s*\(/.test(segment),
      ),
  },
  {
    name: 'effect-no-runfork-without-observer',
    message: 'Do not call runFork without explicit observation, supervision, or interruption.',
    check: hasRunForkWithoutObserver,
  },
  {
    name: 'effect-no-sync-for-promise',
    message: 'Use Effect.tryPromise for Promise-returning code instead of Effect.sync.',
    check: hasSyncForPromise,
  },
  {
    name: 'effect-no-sync-for-throwing-ops',
    message: 'Use Effect.try for synchronous code that can throw instead of Effect.sync.',
    check: hasSyncForThrowingOps,
  },
  {
    name: 'effect-no-console-log-in-effect-code',
    message: 'Use Effect logging APIs instead of console logging in Effect code.',
    ast: (context, source) => ({
      CallExpression(node) {
        const { objectName, propertyName } = memberParts((node as AstNode).callee);
        if (
          hasEffectSignal(source) &&
          objectName === 'console' &&
          propertyName &&
          ['debug', 'error', 'info', 'log', 'warn'].includes(propertyName)
        ) {
          reportAst(
            context,
            'Use Effect logging APIs instead of console logging in Effect code.',
            node,
          );
        }
      },
    }),
  },
  {
    name: 'effect-no-process-env-in-effect-code',
    message: 'Use Effect Config instead of process.env in Effect code.',
    ast: (context, source) => ({
      MemberExpression(node) {
        const { objectName, propertyName } = memberParts(node);
        const processEnv = objectName === 'process' && propertyName === 'env';
        if (hasEffectSignal(source) && !isConfiguredPath(context, 'configLayers') && processEnv) {
          reportAst(context, 'Use Effect Config instead of process.env in Effect code.', node);
        }
      },
    }),
  },
  {
    name: 'effect-no-date-now-in-effect-code',
    message: 'Use Effect Clock instead of Date.now in Effect code.',
    ast: (context, source) => ({
      CallExpression(node) {
        const { objectName, propertyName } = memberParts((node as AstNode).callee);
        if (
          hasEffectSignal(source) &&
          !isConfiguredPath(context, 'adapterLayers') &&
          objectName === 'Date' &&
          propertyName === 'now'
        ) {
          reportAst(context, 'Use Effect Clock instead of Date.now in Effect code.', node);
        }
      },
    }),
  },
  {
    name: 'effect-no-math-random-in-effect-code',
    message: 'Use Effect Random instead of Math.random in Effect code.',
    ast: (context, source) => ({
      CallExpression(node) {
        const { objectName, propertyName } = memberParts((node as AstNode).callee);
        if (
          hasEffectSignal(source) &&
          !isConfiguredPath(context, 'adapterLayers') &&
          objectName === 'Math' &&
          propertyName === 'random'
        ) {
          reportAst(context, 'Use Effect Random instead of Math.random in Effect code.', node);
        }
      },
    }),
  },
  {
    name: 'effect-no-json-parse-cast',
    message: 'Decode external JSON with Schema instead of casting parsed unknown data.',
    patterns: [
      /\bJSON\.parse\s*\([^)]*\)\s+as\s+[A-Za-z_$][\w$]*/,
      /\.json\s*\(\s*\)\s+as\s+[A-Za-z_$][\w$]*/,
    ],
  },
  {
    name: 'effect-schema-prefer-decodeUnknown-effect',
    message: 'Use Schema.decodeUnknown to decode unknown input into the Effect error channel.',
    check: hasSchemaPromiseDecode,
  },
  {
    name: 'effect-schema-require-parse-error-handling',
    message: 'Schema parsing must expose parse errors through typed Effect handling.',
    check: hasUnhandledSchemaEffectDecode,
  },
  {
    name: 'effect-schema-use-decodeUnknown-for-external-data',
    message: 'External data must enter through Schema.decodeUnknown.',
    check: hasExternalJsonWithoutDecodeUnknown,
  },
  {
    name: 'effect-schema-no-unsafe-sync-decode-in-effect-code',
    message: 'Do not use throwing synchronous Schema decoders in Effect modules.',
    check: hasSchemaSyncDecodeInEffectWorkflow,
  },
  {
    name: 'effect-schema-require-parseJson-for-json-strings',
    message: 'Use Schema.parseJson when decoding JSON strings with Schema.',
    check: hasJsonParsedBeforeSchemaStringDecode,
  },
  {
    name: 'effect-schema-correct-number-type-for-parsed-json',
    message: 'Use the correct Schema number type for already-parsed JSON numbers.',
    check: hasParsedJsonNumberFromString,
  },
  {
    name: 'effect-schema-prefer-taggedClass-over-manual-tag',
    message: 'Prefer Schema.TaggedClass over hand-written _tag fields.',
    patterns: [/Schema\.Struct\s*\(\s*{[\s\S]*?_tag\s*:\s*Schema\.Literal/],
  },
  {
    name: 'effect-schema-avoid-old-type-names',
    message: 'Use current Effect Schema API names instead of obsolete lowercase helpers.',
    patterns: [/\bSchema\.(?:string|number|boolean|array|object)\s*\(/],
  },
  {
    name: 'effect-schema-no-cast-after-decode',
    message: 'Do not cast after Schema decoding; let the schema provide the type.',
    check: hasCastAfterSchemaDecode,
  },
  {
    name: 'effect-require-acquire-release',
    message: 'Resource acquisition must use acquireRelease, scoped, or equivalent finalization.',
    check: hasUnreleasedAcquire,
  },
  {
    name: 'effect-require-scoped-for-acquireRelease',
    message: 'Use Effect.scoped around acquireRelease when exposing acquired resources.',
    check: hasUnscopedAcquireRelease,
  },
  {
    name: 'effect-require-scoped-for-resources',
    message: 'Resourceful workflows must be scoped.',
    check: hasUnscopedResourceWorkflow,
  },
  {
    name: 'effect-no-fork-daemon-without-cleanup',
    message: 'Daemon fibers must have cleanup, interruption, or supervision.',
    check: hasForkDaemonWithoutCleanup,
  },
  {
    name: 'effect-prefer-fork-scoped-for-listeners',
    message: 'Long-running listeners should use forkScoped so they follow Scope lifetime.',
    patterns: [
      /Effect\.fork\s*\([\s\S]*?\b(?:listen[A-Z]\w*|subscribe[A-Z]\w*|watch[A-Z]\w*|listen|subscribe|watch)\b/,
    ],
  },
  {
    name: 'effect-require-restore-for-fork-in-uninterruptible',
    message: 'Use restore when forking inside uninterruptible regions.',
    check: hasForkInUninterruptibleWithoutRestore,
  },
  {
    name: 'effect-require-bounded-concurrency',
    message: 'Concurrent Effect traversal must declare an explicit concurrency bound.',
    check: hasUnboundedEffectConcurrency,
  },
  {
    name: 'effect-require-bounded-flatMap-concurrency',
    message: 'Concurrent Effect.flatMap usage must declare a bounded concurrency value.',
    check: hasUnboundedFlatMapConcurrency,
  },
  {
    name: 'effect-no-unbounded-queue',
    message: 'Use bounded, sliding, or dropping queues instead of unbounded queues.',
    patterns: [/\bQueue\.unbounded\s*\(/],
  },
  {
    name: 'effect-no-unbounded-stream-buffer',
    message: 'Stream buffers must be explicitly bounded.',
    patterns: [
      /\bStream\.(?:buffer|fromQueue|async|asyncPush)\s*\([^)]*\b(?:Infinity|unbounded)\b/,
    ],
  },
  {
    name: 'effect-test-no-runpromise',
    message: 'Use @effect/vitest it.effect instead of manually running Effects in tests.',
    check: (source, context) => isEffectTestPath(context) && hasRuntimeCall(source),
  },
  {
    name: 'effect-prefer-it-effect-for-unit-tests',
    message: 'Use it.effect for tests that exercise Effect programs.',
    check: (source, context) =>
      isEffectTestPath(context) &&
      !hasRuntimeCall(source) &&
      /\bit\s*\([\s\S]*?Effect\./.test(stripCommentsAndStrings(source)),
  },
  {
    name: 'effect-testClock-requires-fork',
    message: 'Fork time-dependent work before adjusting TestClock.',
    check: (source) =>
      /TestClock\.adjust\s*\(/.test(stripCommentsAndStrings(source)) &&
      !hasForkBeforeTestClockAdjust(source),
  },
  {
    name: 'effect-testClock-requires-testContext',
    message: 'Use Effect test context when using TestClock.',
    check: (source, context) =>
      isEffectTestPath(context) && hasTestClockWithoutEffectContext(source),
  },
  {
    name: 'effect-no-real-sleep-in-tests',
    message: 'Use TestClock instead of real sleeps in Effect tests.',
    check: (source, context) => isEffectTestPath(context) && hasRealSleepWithoutTestClock(source),
  },
  {
    name: 'effect-use-exit-for-failure-tests',
    message: 'Use Effect.exit inside it.effect when asserting Effect failures.',
    check: (source, context) =>
      isEffectTestPath(context) &&
      !hasRuntimeCall(source) &&
      /\b(?:rejects|toThrow)\b/.test(stripCommentsAndStrings(source)) &&
      /\bEffect\./.test(stripCommentsAndStrings(source)),
  },
  {
    name: 'effect-no-focused-effect-tests',
    message: 'Focused Effect tests must not be committed.',
    check: (source, context) =>
      isEffectTestPath(context) &&
      /\b(?:it|describe)\.effect\.only\s*\(/.test(stripCommentsAndStrings(source)),
  },
  {
    name: 'effect-no-skipped-effect-tests',
    message: 'Skipped Effect tests must not be committed.',
    check: (source, context) =>
      isEffectTestPath(context) &&
      /\b(?:it|describe)\.effect\.skip\s*\(/.test(stripCommentsAndStrings(source)),
  },
  {
    name: 'effect-no-obsolete-imports',
    message:
      'Import Effect APIs from the main effect package; deprecated split packages are blocked.',
    patterns: [/from\s+['"]@effect\/(?:io|data)['"]/],
  },
  {
    name: 'effect-no-known-fake-api',
    message: 'This is not a known Effect API for the configured version.',
    check: (source) =>
      /\bEffect\.(?:fromPromise|tryCatch|bracket|fromEither)\s*\(/.test(
        stripCommentsAndStrings(source),
      ),
  },
  {
    name: 'effect-prefer-gen-over-do',
    message: 'Prefer Effect.gen over Effect.Do for agent-readable sequential workflows.',
    patterns: [/\bEffect\.Do\b/],
  },
  {
    name: 'effect-prefer-direct-yield-star',
    message: 'Use direct yield* effect style instead of adapter-style Effect.gen helpers.',
    patterns: [/Effect\.gen\s*\(\s*function\*\s*\(\s*\$\s*\)/],
  },
  {
    name: 'effect-prefer-config-redacted',
    message:
      'Use Config.redacted for sensitive config values so secrets stay redacted in logs and errors.',
    patterns: [/Config\.(?:secret|Secret)\s*\(/],
  },
  {
    name: 'effect-no-deprecated-schema-package',
    message: 'Use Schema from effect/Schema instead of @effect/schema.',
    patterns: [/from\s+['"]@effect\/schema['"]/],
  },
  {
    name: 'effect-no-deprecated-context-tag-function',
    message: 'Use the current Context.Tag class/service pattern instead of deprecated tag helpers.',
    patterns: [
      /\b(?:const|let|var)\s+[A-Z][\w$]*\s*=\s*Context\.Tag(?:<[^>]+>)?\s*\(\s*['"][^'"]+['"]\s*\)/,
      /(?:^|[;\n]\s*)Context\.Tag(?:<[^>]+>)?\s*\(\s*['"][^'"]+['"]\s*\)/,
    ],
  },
  {
    name: 'effect-no-global-error-channel',
    message: 'Use domain-specific tagged errors instead of the global Error type channel.',
    patterns: [/Effect\.Effect\s*<[^,>]+,\s*Error\s*[,>]/],
  },
  {
    name: 'effect-use-duration-constructors',
    message: 'Use Duration constructors or string durations instead of naked millisecond numbers.',
    patterns: [
      /Effect\.(?:sleep|timeout|delay)\s*\(\s*\d+\s*\)/,
      /Effect\.(?:timeout|delay)\s*\([^,]+,\s*\d+\s*\)/,
    ],
  },
  {
    name: 'effect-no-mixed-effect-import-styles',
    message: 'Use one Effect import style per file.',
    check: hasMixedEffectImportStyles,
  },
  {
    name: 'effect-prefer-effect-is',
    message: 'Use Effect.isEffect for Effect type checks.',
    patterns: [/\b[A-Za-z_$][\w$]*\s+instanceof\s+Effect\b/, /\._op\s*===\s*['"]Effect['"]/],
  },
  {
    name: 'effect-no-try-catch-in-effect-gen',
    message: 'Use Effect error combinators instead of try/catch inside Effect.gen.',
    ast: (context, source) => ({
      TryStatement(node) {
        const { start } = node as { start?: number };
        if (typeof start !== 'number') {
          return;
        }
        const index = hasTryCatchInEffectGen(source);
        if (typeof index === 'number' && index === start) {
          reportAst(
            context,
            'Use Effect error combinators instead of try/catch inside Effect.gen.',
            node,
          );
        }
      },
    }),
  },
  {
    name: 'effect-no-new-promise',
    message: 'Use Effect.async, Effect.promise, or Effect.tryPromise instead of new Promise.',
    ast: (context, source) => ({
      NewExpression(node) {
        if (hasEffectSignal(source) && identifierName((node as AstNode).callee) === 'Promise') {
          reportAst(
            context,
            'Use Effect.async, Effect.promise, or Effect.tryPromise instead of new Promise.',
            node,
          );
        }
      },
    }),
  },
  {
    name: 'effect-no-global-timers',
    message: 'Use Effect.sleep, Schedule, or Clock instead of global timers in Effect modules.',
    ast: (context, source) => ({
      CallExpression(node) {
        const calleeName = identifierName((node as AstNode).callee);
        if (
          hasEffectSignal(source) &&
          calleeName &&
          ['clearInterval', 'clearTimeout', 'setInterval', 'setTimeout'].includes(calleeName)
        ) {
          reportAst(
            context,
            'Use Effect.sleep, Schedule, or Clock instead of global timers in Effect modules.',
            node,
          );
        }
      },
    }),
  },
  {
    name: 'effect-no-native-error-classes',
    message: 'Use tagged/data/schema errors instead of classes extending native Error.',
    check: hasNativeErrorClassInEffectModule,
    ast: (context, source) => ({
      ClassDeclaration(node) {
        if (hasEffectSignal(source) && identifierName((node as AstNode).superClass) === 'Error') {
          reportAst(
            context,
            'Use tagged/data/schema errors instead of classes extending native Error.',
            node,
          );
        }
      },
    }),
  },
  {
    name: 'effect-no-unsafe-effect-type-assertion',
    message: 'Do not assert Effect error or requirement channels with type casts.',
    check: hasUnsafeEffectTypeAssertion,
    ast: (context) => ({
      TSAsExpression(node) {
        if (typeReferenceName((node as AstNode).typeAnnotation) === 'Effect.Effect') {
          reportAst(
            context,
            'Do not assert Effect error or requirement channels with type casts.',
            node,
          );
        }
      },
    }),
  },
  {
    name: 'effect-require-service-self-match',
    message: 'Effect service/tag self type must match the declaring class name.',
    check: hasServiceSelfMismatch,
    ast: (context, source) => ({
      ClassDeclaration(node) {
        const className = identifierName((node as AstNode).id);
        const selfName = effectServiceSelfName((node as AstNode).superClass, source);
        if (className && selfName && className !== selfName) {
          reportAst(
            context,
            'Effect service/tag self type must match the declaring class name.',
            node,
          );
        }
      },
    }),
  },
  {
    name: 'effect-no-effect-fn-iife',
    message: 'Do not call Effect.fn as an IIFE; use Effect.gen for local one-shot workflows.',
    check: hasEffectFnIife,
    ast: (context, source) => ({
      CallExpression(node) {
        const outerCallee = (node as AstNode).callee as AstNode | undefined;
        const middleCallee = outerCallee?.callee as AstNode | undefined;
        const innerCallee = middleCallee?.callee;
        if (
          nodeType(outerCallee) === 'CallExpression' &&
          nodeType(middleCallee) === 'CallExpression' &&
          isEffectMember(innerCallee, source, new Set(['fn', 'fnUntraced', 'fnUntracedEager']))
        ) {
          reportAst(
            context,
            'Do not call Effect.fn as an IIFE; use Effect.gen for local one-shot workflows.',
            node,
          );
        }
      },
    }),
  },
] satisfies readonly RuleSpec[];

const effectDefaultRules = makeRules(effectDefaultSpecs, { schema: strictPathOptionsSchema });

export default effectDefaultRules;
