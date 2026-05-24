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

const effectDefaultRuleTokens = [
  'Effect',
  'Schema',
  'Config',
  'Context',
  'Queue',
  'Stream',
  'TestClock',
  'from "effect"',
  "from 'effect'",
  '@effect/',
  '"effect/',
  "'effect/",
  'it.effect',
  'describe.effect',
  'JSON.parse',
  'response.json',
] as const;

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

function effectCallPredicate(
  source: string,
  names: readonly string[],
): (callee: unknown) => boolean {
  const memberNames = new Set(names);
  const importAliases = new Set(effectImportAliases(source));
  const functionAliases = new Set(
    names.flatMap((name) => effectFunctionAliases(source, 'Effect', name)),
  );

  return (callee: unknown): boolean => {
    const { objectName, propertyName } = memberParts(callee);
    if (objectName && propertyName) {
      return importAliases.has(objectName) && memberNames.has(propertyName);
    }

    const calleeName = identifierName(callee);
    return Boolean(calleeName && functionAliases.has(calleeName));
  };
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
    tokenGroups: [['gen'], ['yield']],
    check: hasYieldWithoutStarInGen,
  },
  {
    name: 'effect-require-return-yield-star',
    message: 'Do not return an Effect from Effect.gen; return a value or return yield* the Effect.',
    tokenGroups: [['gen'], ['return']],
    check: hasReturnEffectInGen,
  },
  {
    name: 'effect-prefer-gen-for-nested-flatmap',
    message: 'Replace nested Effect.flatMap callbacks with Effect.gen for readable sequencing.',
    tokens: ['flatMap'],
    check: hasNestedFlatMap,
  },
  {
    name: 'effect-no-function-returning-gen',
    message: 'Use Effect.fn for exported effectful functions instead of returning Effect.gen.',
    tokens: ['gen'],
    check: (source) =>
      exportedCallableDeclarationSegments(source).some((segment) =>
        /(?:^|\breturn\s+)Effect\.gen\s*\(/.test(segment.trim()),
      ),
  },
  {
    name: 'effect-prefer-effect-fn-for-exported-effects',
    message: 'Exported effectful functions should use Effect.fn for tracing and stable contracts.',
    tokens: ['export'],
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
    tokenGroups: [['gen'], ['yield']],
    patterns: [/Effect\.gen\s*\(\s*function\*\s*\([^)]*\)\s*{\s*return\s+yield\*\s+Effect\./],
  },
  {
    name: 'effect-no-effect-in-array-foreach',
    message: 'Use Effect.forEach instead of Array.forEach with Effect-returning callbacks.',
    tokens: ['forEach'],
    check: hasEffectInArrayForEach,
  },
  {
    name: 'effect-no-effect-in-promise-callback',
    message:
      'Do not create Effect values inside Promise callbacks; compose at the Effect boundary.',
    tokens: ['.then', '.catch'],
    check: hasEffectInPromiseCallback,
  },
  {
    name: 'effect-no-floating-fiber',
    message: 'Forked fibers must be joined, interrupted, scoped, supervised, or returned.',
    tokens: ['fork'],
    check: hasUnobservedFork,
  },
  {
    name: 'effect-require-suspend-for-recursion',
    message: 'Recursive Effect construction must be wrapped in Effect.suspend.',
    tokens: ['function', '=>'],
    check: hasRecursiveEffectWithoutSuspend,
  },
  {
    name: 'effect-require-suspend-for-lazy-evaluation',
    message: 'Use Effect.suspend when Effect construction must defer eager JavaScript work.',
    tokens: ['Date.now', 'Math.random', 'new Date', 'JSON.parse'],
    check: hasUnsafeLazyEvaluation,
  },
  {
    name: 'effect-no-async-await-in-effect',
    message:
      'Use Effect.tryPromise or Effect.promise boundaries instead of async/await in Effect code.',
    tokens: ['async', 'await'],
    check: hasAsyncAwaitInEffect,
  },
  {
    name: 'effect-no-promise-then-in-effect',
    message: 'Use Effect combinators instead of Promise then/catch chains in Effect modules.',
    tokens: ['.then', '.catch'],
    ast: (context, source) => {
      const isEffectModule = hasEffectSignal(source);
      return {
        CallExpression(node) {
          if (!isEffectModule) {
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
      };
    },
  },
  {
    name: 'effect-no-throw',
    message: 'Use typed Effect failures instead of throw inside Effect workflows.',
    tokens: ['throw'],
    check: hasThrowInEffect,
  },
  {
    name: 'effect-no-string-errors',
    message: 'Use structured tagged errors instead of string failures.',
    tokens: ['fail'],
    check: hasStringErrorFailure,
    ast: (context, source) => {
      const isEffectFail = effectCallPredicate(source, ['fail']);
      return {
        CallExpression(node) {
          const call = node as { arguments?: unknown[]; callee?: unknown };
          if (isEffectFail(call.callee) && isStringLikeLiteral(call.arguments?.[0])) {
            reportAst(context, 'Use structured tagged errors instead of string failures.', node);
          }
        },
      };
    },
  },
  {
    name: 'effect-no-untagged-errors',
    message: 'Use tagged/data/schema errors in Effect.fail instead of global Error values.',
    tokens: ['fail'],
    check: hasUntaggedErrorFailure,
    ast: (context, source) => {
      const isEffectFail = effectCallPredicate(source, ['fail']);
      return {
        CallExpression(node) {
          const call = node as { arguments?: unknown[]; callee?: unknown };
          const firstArg = call.arguments?.[0] as AstNode | undefined;
          if (!isEffectFail(call.callee)) {
            return;
          }
          if (!firstArg) {
            return;
          }
          if (
            nodeType(firstArg) === 'NewExpression' &&
            identifierName(firstArg.callee) === 'Error'
          ) {
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
      };
    },
  },
  {
    name: 'effect-no-silent-error-swallowing',
    message:
      'Do not erase Effect failures without recovery, logging, or explicit typed replacement.',
    tokens: ['catchAll', 'ignore'],
    patterns: [
      /Effect\.(?:catchAll|ignore)\s*\([\s\S]*?(?:Effect\.void|Effect\.succeed\s*\(\s*undefined|undefined)/,
    ],
  },
  {
    name: 'effect-require-typed-error-in-trypromise',
    message:
      'Use Effect.tryPromise({ try, catch }) so Promise failures become typed Effect errors.',
    tokens: ['tryPromise'],
    check: hasTryPromiseWithoutTypedCatch,
  },
  {
    name: 'effect-prefer-catchTag-over-catchAll',
    message: 'Prefer catchTag or catchTags over broad catchAll recovery.',
    tokens: ['catchAll'],
    check: hasBroadCatchAllWithoutRethrow,
  },
  {
    name: 'effect-no-catchAll-with-mapError',
    message: 'Use mapError directly instead of catchAll when only transforming the error.',
    tokens: ['catchAll'],
    patterns: [/Effect\.catchAll\s*\([\s\S]*?=>\s*Effect\.fail\s*\(/],
  },
  {
    name: 'effect-prefer-mapError-over-catchAll-rethrow',
    message: 'Use Effect.mapError instead of catchAll followed by fail.',
    tokens: ['catchAll'],
    patterns: [/(?:^|[^\w$.])catchAll\s*\([\s\S]*?=>\s*Effect\.fail\s*\(/],
  },
  {
    name: 'effect-require-error-cause-preserved',
    message: 'Preserve the original cause when mapping or wrapping Effect errors.',
    tokens: ['mapError', 'catchAll'],
    check: hasErrorMappingWithoutCause,
  },
  {
    name: 'effect-prefer-ignore-logged',
    message: 'Ignored Effect failures must be logged or otherwise observable.',
    tokens: ['ignore'],
    check: hasUnloggedIgnore,
  },
  {
    name: 'effect-prefer-catchTags-for-multiple-tags',
    message: 'Use Effect.catchTags for multiple tagged Effect recoveries.',
    tokens: ['catchTag'],
    check: hasMultipleCatchTagsInOnePipe,
  },
  {
    name: 'effect-no-error-channel-widening-to-unknown',
    message: 'Do not widen Effect error channels to unknown.',
    tokens: ['unknown'],
    patterns: [/Effect\s*<[^>]*,\s*unknown\b/, /Effect\.fail\s*<\s*unknown\b/],
  },
  {
    name: 'effect-no-run-inside-effect',
    message: 'Do not run an Effect from inside another Effect; yield or compose it instead.',
    tokens: ['run'],
    check: hasRuntimeInEffect,
  },
  {
    name: 'effect-no-runpromise-in-exported-api',
    message:
      'Exported APIs should expose Effect values instead of hiding execution behind Promise.',
    tokens: ['runPromise'],
    check: (source) =>
      exportedDeclarationSegments(source).some((segment) =>
        /Effect\.runPromise\s*\(/.test(segment),
      ),
  },
  {
    name: 'effect-no-runfork-without-observer',
    message: 'Do not call runFork without explicit observation, supervision, or interruption.',
    tokens: ['runFork'],
    check: hasRunForkWithoutObserver,
  },
  {
    name: 'effect-no-sync-for-promise',
    message: 'Use Effect.tryPromise for Promise-returning code instead of Effect.sync.',
    tokenGroups: [['sync'], ['async', 'fetch', 'Promise.']],
    check: hasSyncForPromise,
  },
  {
    name: 'effect-no-sync-for-throwing-ops',
    message: 'Use Effect.try for synchronous code that can throw instead of Effect.sync.',
    tokenGroups: [['sync'], ['throw', 'JSON.parse']],
    check: hasSyncForThrowingOps,
  },
  {
    name: 'effect-no-console-log-in-effect-code',
    message: 'Use Effect logging APIs instead of console logging in Effect code.',
    tokens: ['console'],
    ast: (context, source) => {
      const isEffectModule = hasEffectSignal(source);
      return {
        CallExpression(node) {
          const { objectName, propertyName } = memberParts((node as AstNode).callee);
          if (
            isEffectModule &&
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
      };
    },
  },
  {
    name: 'effect-no-process-env-in-effect-code',
    message: 'Use Effect Config instead of process.env in Effect code.',
    tokens: ['process'],
    ast: (context, source) => {
      const isEffectModule = hasEffectSignal(source);
      const isConfigLayer = isConfiguredPath(context, 'configLayers');
      return {
        MemberExpression(node) {
          const { objectName, propertyName } = memberParts(node);
          const processEnv = objectName === 'process' && propertyName === 'env';
          if (isEffectModule && !isConfigLayer && processEnv) {
            reportAst(context, 'Use Effect Config instead of process.env in Effect code.', node);
          }
        },
      };
    },
  },
  {
    name: 'effect-no-date-now-in-effect-code',
    message: 'Use Effect Clock instead of Date.now in Effect code.',
    tokens: ['Date'],
    ast: (context, source) => {
      const isEffectModule = hasEffectSignal(source);
      const isAdapterLayer = isConfiguredPath(context, 'adapterLayers');
      return {
        CallExpression(node) {
          const { objectName, propertyName } = memberParts((node as AstNode).callee);
          if (
            isEffectModule &&
            !isAdapterLayer &&
            objectName === 'Date' &&
            propertyName === 'now'
          ) {
            reportAst(context, 'Use Effect Clock instead of Date.now in Effect code.', node);
          }
        },
      };
    },
  },
  {
    name: 'effect-no-math-random-in-effect-code',
    message: 'Use Effect Random instead of Math.random in Effect code.',
    tokens: ['Math'],
    ast: (context, source) => {
      const isEffectModule = hasEffectSignal(source);
      const isAdapterLayer = isConfiguredPath(context, 'adapterLayers');
      return {
        CallExpression(node) {
          const { objectName, propertyName } = memberParts((node as AstNode).callee);
          if (
            isEffectModule &&
            !isAdapterLayer &&
            objectName === 'Math' &&
            propertyName === 'random'
          ) {
            reportAst(context, 'Use Effect Random instead of Math.random in Effect code.', node);
          }
        },
      };
    },
  },
  {
    name: 'effect-no-json-parse-cast',
    message: 'Decode external JSON with Schema instead of casting parsed unknown data.',
    tokenGroups: [[' as '], ['JSON.parse', '.json']],
    patterns: [
      /\bJSON\.parse\s*\([^)]*\)\s+as\s+[A-Za-z_$][\w$]*/,
      /\.json\s*\(\s*\)\s+as\s+[A-Za-z_$][\w$]*/,
    ],
  },
  {
    name: 'effect-schema-prefer-decodeUnknown-effect',
    message: 'Use Schema.decodeUnknown to decode unknown input into the Effect error channel.',
    tokens: ['decode'],
    check: hasSchemaPromiseDecode,
  },
  {
    name: 'effect-schema-require-parse-error-handling',
    message: 'Schema parsing must expose parse errors through typed Effect handling.',
    tokens: ['decode'],
    check: hasUnhandledSchemaEffectDecode,
  },
  {
    name: 'effect-schema-use-decodeUnknown-for-external-data',
    message: 'External data must enter through Schema.decodeUnknown.',
    tokens: ['.json'],
    check: hasExternalJsonWithoutDecodeUnknown,
  },
  {
    name: 'effect-schema-no-unsafe-sync-decode-in-effect-code',
    message: 'Do not use throwing synchronous Schema decoders in Effect modules.',
    tokens: ['decodeSync', 'decodeUnknownSync'],
    check: hasSchemaSyncDecodeInEffectWorkflow,
  },
  {
    name: 'effect-schema-require-parseJson-for-json-strings',
    message: 'Use Schema.parseJson when decoding JSON strings with Schema.',
    tokens: ['JSON.parse'],
    check: hasJsonParsedBeforeSchemaStringDecode,
  },
  {
    name: 'effect-schema-correct-number-type-for-parsed-json',
    message: 'Use the correct Schema number type for already-parsed JSON numbers.',
    tokens: ['JSON.parse'],
    check: hasParsedJsonNumberFromString,
  },
  {
    name: 'effect-schema-prefer-taggedClass-over-manual-tag',
    message: 'Prefer Schema.TaggedClass over hand-written _tag fields.',
    tokens: ['_tag'],
    patterns: [/Schema\.Struct\s*\(\s*{[\s\S]*?_tag\s*:\s*Schema\.Literal/],
  },
  {
    name: 'effect-schema-avoid-old-type-names',
    message: 'Use current Effect Schema API names instead of obsolete lowercase helpers.',
    tokens: ['Schema.'],
    patterns: [/\bSchema\.(?:string|number|boolean|array|object)\s*\(/],
  },
  {
    name: 'effect-schema-no-cast-after-decode',
    message: 'Do not cast after Schema decoding; let the schema provide the type.',
    tokenGroups: [['Schema.decode'], [' as ']],
    check: hasCastAfterSchemaDecode,
  },
  {
    name: 'effect-require-acquire-release',
    message: 'Resource acquisition must use acquireRelease, scoped, or equivalent finalization.',
    tokens: ['open', 'connect', 'subscribe', 'listen'],
    check: hasUnreleasedAcquire,
  },
  {
    name: 'effect-require-scoped-for-acquireRelease',
    message: 'Use Effect.scoped around acquireRelease when exposing acquired resources.',
    tokens: ['acquireRelease'],
    check: hasUnscopedAcquireRelease,
  },
  {
    name: 'effect-require-scoped-for-resources',
    message: 'Resourceful workflows must be scoped.',
    tokens: ['Socket.', 'Connection.'],
    check: hasUnscopedResourceWorkflow,
  },
  {
    name: 'effect-no-fork-daemon-without-cleanup',
    message: 'Daemon fibers must have cleanup, interruption, or supervision.',
    tokens: ['forkDaemon'],
    check: hasForkDaemonWithoutCleanup,
  },
  {
    name: 'effect-prefer-fork-scoped-for-listeners',
    message: 'Long-running listeners should use forkScoped so they follow Scope lifetime.',
    tokens: ['fork'],
    patterns: [
      /Effect\.fork\s*\([\s\S]*?\b(?:listen[A-Z]\w*|subscribe[A-Z]\w*|watch[A-Z]\w*|listen|subscribe|watch)\b/,
    ],
  },
  {
    name: 'effect-require-restore-for-fork-in-uninterruptible',
    message: 'Use restore when forking inside uninterruptible regions.',
    tokenGroups: [['uninterruptible'], ['fork']],
    check: hasForkInUninterruptibleWithoutRestore,
  },
  {
    name: 'effect-require-bounded-concurrency',
    message: 'Concurrent Effect traversal must declare an explicit concurrency bound.',
    tokens: ['concurrency'],
    check: hasUnboundedEffectConcurrency,
  },
  {
    name: 'effect-require-bounded-flatMap-concurrency',
    message: 'Concurrent Effect.flatMap usage must declare a bounded concurrency value.',
    tokenGroups: [['flatMap'], ['concurrency']],
    check: hasUnboundedFlatMapConcurrency,
  },
  {
    name: 'effect-no-unbounded-queue',
    message: 'Use bounded, sliding, or dropping queues instead of unbounded queues.',
    tokens: ['unbounded'],
    patterns: [/\bQueue\.unbounded\s*\(/],
  },
  {
    name: 'effect-no-unbounded-stream-buffer',
    message: 'Stream buffers must be explicitly bounded.',
    tokens: ['unbounded', 'Infinity'],
    patterns: [
      /\bStream\.(?:buffer|fromQueue|async|asyncPush)\s*\([^)]*\b(?:Infinity|unbounded)\b/,
    ],
  },
  {
    name: 'effect-test-no-runpromise',
    message: 'Use @effect/vitest it.effect instead of manually running Effects in tests.',
    tokens: ['run'],
    check: (source, context) => isEffectTestPath(context) && hasRuntimeCall(source),
  },
  {
    name: 'effect-prefer-it-effect-for-unit-tests',
    message: 'Use it.effect for tests that exercise Effect programs.',
    tokens: ['it('],
    check: (source, context) =>
      isEffectTestPath(context) &&
      !hasRuntimeCall(source) &&
      /\bit\s*\([\s\S]*?Effect\./.test(stripCommentsAndStrings(source)),
  },
  {
    name: 'effect-testClock-requires-fork',
    message: 'Fork time-dependent work before adjusting TestClock.',
    tokens: ['TestClock.adjust'],
    check: (source) =>
      /TestClock\.adjust\s*\(/.test(stripCommentsAndStrings(source)) &&
      !hasForkBeforeTestClockAdjust(source),
  },
  {
    name: 'effect-testClock-requires-testContext',
    message: 'Use Effect test context when using TestClock.',
    tokens: ['TestClock'],
    check: (source, context) =>
      isEffectTestPath(context) && hasTestClockWithoutEffectContext(source),
  },
  {
    name: 'effect-no-real-sleep-in-tests',
    message: 'Use TestClock instead of real sleeps in Effect tests.',
    tokens: ['sleep'],
    check: (source, context) => isEffectTestPath(context) && hasRealSleepWithoutTestClock(source),
  },
  {
    name: 'effect-use-exit-for-failure-tests',
    message: 'Use Effect.exit inside it.effect when asserting Effect failures.',
    tokens: ['rejects', 'toThrow'],
    check: (source, context) =>
      isEffectTestPath(context) &&
      !hasRuntimeCall(source) &&
      /\b(?:rejects|toThrow)\b/.test(stripCommentsAndStrings(source)) &&
      /\bEffect\./.test(stripCommentsAndStrings(source)),
  },
  {
    name: 'effect-no-focused-effect-tests',
    message: 'Focused Effect tests must not be committed.',
    tokens: ['.only'],
    check: (source, context) =>
      isEffectTestPath(context) &&
      /\b(?:it|describe)\.effect\.only\s*\(/.test(stripCommentsAndStrings(source)),
  },
  {
    name: 'effect-no-skipped-effect-tests',
    message: 'Skipped Effect tests must not be committed.',
    tokens: ['.skip'],
    check: (source, context) =>
      isEffectTestPath(context) &&
      /\b(?:it|describe)\.effect\.skip\s*\(/.test(stripCommentsAndStrings(source)),
  },
  {
    name: 'effect-no-obsolete-imports',
    message:
      'Import Effect APIs from the main effect package; deprecated split packages are blocked.',
    tokens: ['@effect/io', '@effect/data'],
    patterns: [/from\s+['"]@effect\/(?:io|data)['"]/],
  },
  {
    name: 'effect-no-known-fake-api',
    message: 'This is not a known Effect API for the configured version.',
    tokens: ['fromPromise', 'tryCatch', 'bracket', 'fromEither'],
    check: (source) =>
      /\bEffect\.(?:fromPromise|tryCatch|bracket|fromEither)\s*\(/.test(
        stripCommentsAndStrings(source),
      ),
  },
  {
    name: 'effect-prefer-gen-over-do',
    message: 'Prefer Effect.gen over Effect.Do for agent-readable sequential workflows.',
    tokens: ['Effect.Do'],
    patterns: [/\bEffect\.Do\b/],
  },
  {
    name: 'effect-prefer-direct-yield-star',
    message: 'Use direct yield* effect style instead of adapter-style Effect.gen helpers.',
    tokenGroups: [['gen'], ['$']],
    patterns: [/Effect\.gen\s*\(\s*function\*\s*\(\s*\$\s*\)/],
  },
  {
    name: 'effect-prefer-config-redacted',
    message:
      'Use Config.redacted for sensitive config values so secrets stay redacted in logs and errors.',
    tokens: ['secret', 'Secret'],
    patterns: [/Config\.(?:secret|Secret)\s*\(/],
  },
  {
    name: 'effect-no-deprecated-schema-package',
    message: 'Use Schema from effect/Schema instead of @effect/schema.',
    tokens: ['@effect/schema'],
    patterns: [/from\s+['"]@effect\/schema['"]/],
  },
  {
    name: 'effect-no-deprecated-context-tag-function',
    message: 'Use the current Context.Tag class/service pattern instead of deprecated tag helpers.',
    tokens: ['Context.Tag'],
    patterns: [
      /\b(?:const|let|var)\s+[A-Z][\w$]*\s*=\s*Context\.Tag(?:<[^>]+>)?\s*\(\s*['"][^'"]+['"]\s*\)/,
      /(?:^|[;\n]\s*)Context\.Tag(?:<[^>]+>)?\s*\(\s*['"][^'"]+['"]\s*\)/,
    ],
  },
  {
    name: 'effect-no-global-error-channel',
    message: 'Use domain-specific tagged errors instead of the global Error type channel.',
    tokenGroups: [['Effect.Effect'], ['Error']],
    patterns: [/Effect\.Effect\s*<[^,>]+,\s*Error\s*[,>]/],
  },
  {
    name: 'effect-use-duration-constructors',
    message: 'Use Duration constructors or string durations instead of naked millisecond numbers.',
    tokens: ['sleep', 'timeout', 'delay'],
    patterns: [
      /Effect\.(?:sleep|timeout|delay)\s*\(\s*\d+\s*\)/,
      /Effect\.(?:timeout|delay)\s*\([^,]+,\s*\d+\s*\)/,
    ],
  },
  {
    name: 'effect-no-mixed-effect-import-styles',
    message: 'Use one Effect import style per file.',
    tokens: ['import'],
    check: hasMixedEffectImportStyles,
  },
  {
    name: 'effect-prefer-effect-is',
    message: 'Use Effect.isEffect for Effect type checks.',
    tokens: ['instanceof', '_op'],
    patterns: [/\b[A-Za-z_$][\w$]*\s+instanceof\s+Effect\b/, /\._op\s*===\s*['"]Effect['"]/],
  },
  {
    name: 'effect-no-try-catch-in-effect-gen',
    message: 'Use Effect error combinators instead of try/catch inside Effect.gen.',
    tokenGroups: [['gen'], ['try']],
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
    tokenGroups: [['Promise'], ['Effect', 'effect']],
    ast: (context, source) => {
      const isEffectModule = hasEffectSignal(source);
      return {
        NewExpression(node) {
          if (isEffectModule && identifierName((node as AstNode).callee) === 'Promise') {
            reportAst(
              context,
              'Use Effect.async, Effect.promise, or Effect.tryPromise instead of new Promise.',
              node,
            );
          }
        },
      };
    },
  },
  {
    name: 'effect-no-global-timers',
    message: 'Use Effect.sleep, Schedule, or Clock instead of global timers in Effect modules.',
    tokens: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
    ast: (context, source) => {
      const isEffectModule = hasEffectSignal(source);
      return {
        CallExpression(node) {
          const calleeName = identifierName((node as AstNode).callee);
          if (
            isEffectModule &&
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
      };
    },
  },
  {
    name: 'effect-no-native-error-classes',
    message: 'Use tagged/data/schema errors instead of classes extending native Error.',
    tokens: ['Error'],
    check: hasNativeErrorClassInEffectModule,
    ast: (context, source) => {
      const isEffectModule = hasEffectSignal(source);
      return {
        ClassDeclaration(node) {
          if (isEffectModule && identifierName((node as AstNode).superClass) === 'Error') {
            reportAst(
              context,
              'Use tagged/data/schema errors instead of classes extending native Error.',
              node,
            );
          }
        },
      };
    },
  },
  {
    name: 'effect-no-unsafe-effect-type-assertion',
    message: 'Do not assert Effect error or requirement channels with type casts.',
    tokenGroups: [[' as '], ['Effect.Effect']],
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
    tokenGroups: [['class'], ['extends'], ['Context', 'Service', 'Tag']],
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
    tokenGroups: [['fn'], ['Effect', 'effect']],
    check: hasEffectFnIife,
    ast: (context, source) => {
      const isEffectFn = effectCallPredicate(source, ['fn', 'fnUntraced', 'fnUntracedEager']);
      return {
        CallExpression(node) {
          const outerCallee = (node as AstNode).callee as AstNode | undefined;
          const middleCallee = outerCallee?.callee as AstNode | undefined;
          const innerCallee = middleCallee?.callee;
          if (
            nodeType(outerCallee) === 'CallExpression' &&
            nodeType(middleCallee) === 'CallExpression' &&
            isEffectFn(innerCallee)
          ) {
            reportAst(
              context,
              'Do not call Effect.fn as an IIFE; use Effect.gen for local one-shot workflows.',
              node,
            );
          }
        },
      };
    },
  },
] satisfies readonly RuleSpec[];

const effectDefaultRules = makeRules(effectDefaultSpecs, {
  defaultTokens: effectDefaultRuleTokens,
  schema: strictPathOptionsSchema,
});

export default effectDefaultRules;
