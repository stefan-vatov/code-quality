import { hasRunForkWithoutObserver } from './effect-default-helpers.js';
import {
  isConfiguredPath,
  isEffectTestPath,
  isUnitTestPath,
  strictPathOptionsSchema,
} from './effect-path-options.js';
import {
  effectApiAliases,
  effectFunctionAliases,
  effectImportAliases,
  hasEffectSignal,
  hasRuntimeCall,
  makeRules,
} from './effect-rule-core.js';
import {
  exportedDeclarationTexts,
  findBalancedCallEnd,
  findMatchingBrace,
  findStatementEnd,
  stripComments,
  stripCommentsAndStrings,
} from './effect-source-helpers.js';
import {
  hasBoundaryDataWithoutSchema,
  hasCommandHandlerWithoutSchema,
  hasDuplicateLayerInstance,
  hasAsyncPushWithoutBuffer,
  hasEnsuringCleanupWithoutOnExit,
  hasExternalEffectWithoutSpan,
  hasExternalEffectWithoutTimeout,
  hasHttpClientResponseWithoutSchema,
  hasHttpServerRequestWithoutSchema,
  hasIdempotentExternalEffectWithoutRetry,
  hasLayerFactory,
  hasLiveTestService,
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
} from './effect-strict-helpers.js';

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

function isVoidZero(node: unknown): boolean {
  if (nodeType(node) !== 'UnaryExpression') {
    return false;
  }
  const unary = node as { argument?: unknown; operator?: string };
  return unary.operator === 'void' && literalValue(unary.argument) === 0;
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

function isMember(node: unknown, objectName: string, propertyName: string): boolean {
  const parts = memberParts(node);
  return parts.objectName === objectName && parts.propertyName === propertyName;
}

function isSchemaMember(node: unknown, source: string, propertyName: string): boolean {
  const parts = memberParts(node);
  return Boolean(
    parts.objectName &&
    parts.propertyName === propertyName &&
    effectApiAliases(source, 'Schema').includes(parts.objectName),
  );
}

function isEffectFunctionCall(callee: unknown, source: string, functionName: string): boolean {
  const calleeName = identifierName(callee);
  return Boolean(
    calleeName && effectFunctionAliases(source, 'Effect', functionName).includes(calleeName),
  );
}

function serviceKeyFromClass(node: AstNode, source: string): { className?: string; key?: string } {
  const { id, superClass } = node;
  const className = identifierName(id);
  if (nodeType(superClass) !== 'CallExpression') {
    return { className };
  }
  const outer = superClass as { arguments?: unknown[]; callee?: unknown };
  const inner = outer.callee as { arguments?: unknown[]; callee?: unknown } | undefined;
  if (!inner || nodeType(inner) !== 'CallExpression') {
    return { className };
  }
  const innerCall = inner;
  const { objectName, propertyName } = memberParts(innerCall.callee);
  if (objectName === 'Context' && (propertyName === 'Tag' || propertyName === 'GenericTag')) {
    return { className, key: literalValue(innerCall.arguments?.[0]) as string | undefined };
  }
  if (
    objectName &&
    effectImportAliases(source).includes(objectName) &&
    propertyName === 'Service'
  ) {
    return { className, key: literalValue(outer.arguments?.[0]) as string | undefined };
  }
  return { className };
}

function hasRetryScheduleWithoutJitter(source: string): boolean {
  for (const match of source.matchAll(/\bEffect\.retry\s*\(/g)) {
    const openParenIndex = source.indexOf('(', match.index);
    const callBody = source.slice(openParenIndex + 1, findBalancedCallEnd(source, openParenIndex));
    if (/\bSchedule\./.test(callBody) && !/\bjitter(?:ed)?\b/.test(callBody)) {
      return true;
    }
  }

  return false;
}

function publicApiDeclarationSignature(declaration: string): string {
  if (/^\s*(?:export\s+)?(?:async\s+)?function\b/.test(declaration)) {
    const bodyStart = declaration.indexOf('{');
    return bodyStart === -1 ? declaration : declaration.slice(0, bodyStart);
  }

  if (/^\s*(?:export\s+)?(?:const|let|var)\b/.test(declaration)) {
    const bodyStart = declaration.indexOf('{');
    return bodyStart === -1 ? declaration : declaration.slice(0, bodyStart);
  }

  return declaration;
}

function hasClassPromiseReturningPublicMember(declaration: string): boolean {
  if (!/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\b/.test(declaration)) {
    return false;
  }

  const signatureSource = stripCommentsAndStrings(declaration);
  const publicMemberPrefix =
    '(?!private\\b|protected\\b)(?:(?:public|static|abstract|override|declare|readonly)\\s+)*';
  const memberName = '[A-Za-z_$][\\w$]*';
  const memberStart = `(?:^|[{\\n;]\\s*)${publicMemberPrefix}${memberName}`;
  const accessorStart = `(?:^|[{\\n;]\\s*)${publicMemberPrefix}`;
  return (
    new RegExp(`${memberStart}\\s*\\([^)]*\\)\\s*:\\s*Promise\\s*<`).test(signatureSource) ||
    new RegExp(`(?:^|[{\\n;]\\s*)${publicMemberPrefix}async\\s+${memberName}\\s*\\([^)]*\\)`).test(
      signatureSource,
    ) ||
    new RegExp(`${memberStart}\\s*=\\s*async\\b`).test(signatureSource) ||
    new RegExp(`${memberStart}\\s*=\\s*\\([^)]*\\)\\s*:\\s*Promise\\s*<`).test(signatureSource) ||
    new RegExp(`${memberStart}\\s*:\\s*[^;\\n=]*Promise\\s*<`).test(signatureSource) ||
    new RegExp(`${accessorStart}get\\s+${memberName}\\s*\\([^)]*\\)\\s*:\\s*Promise\\s*<`).test(
      signatureSource,
    ) ||
    new RegExp(`${accessorStart}accessor\\s+${memberName}\\s*:\\s*[^;\\n=]*Promise\\s*<`).test(
      signatureSource,
    )
  );
}

function hasPromiseReturningPublicApi(source: string): boolean {
  return exportedDeclarationTexts(source).some((declaration) => {
    if (/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\b/.test(declaration)) {
      return hasClassPromiseReturningPublicMember(declaration);
    }

    const signature = stripCommentsAndStrings(publicApiDeclarationSignature(declaration));
    return (
      /\bPromise\s*</.test(signature) ||
      /^\s*(?:export\s+)?async\s+function\b/.test(signature) ||
      /=\s*async\b/.test(signature)
    );
  });
}

function hasExportedRunPromiseApi(source: string): boolean {
  return exportedDeclarationTexts(source).some((declaration) =>
    /\bEffect\.runPromise\s*\(/.test(stripCommentsAndStrings(declaration)),
  );
}

function hasRunSyncInServerRequestHandler(source: string): boolean {
  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(/\b(?:handler|route|loader|action)\s*=/g)) {
    const segment = code.slice(match.index, findStatementEnd(code, match.index) + 1);
    if (/\bEffect\.runSync\s*\(/.test(segment)) {
      return true;
    }
  }

  for (const match of code.matchAll(/\bfunction\s+(?:handler|route|loader|action)\s*\(/g)) {
    const bodyStart = code.indexOf('{', match.index);
    if (bodyStart === -1) {
      continue;
    }
    const bodyEnd = findMatchingBrace(code, bodyStart);
    if (bodyEnd !== -1 && /\bEffect\.runSync\s*\(/.test(code.slice(bodyStart, bodyEnd + 1))) {
      return true;
    }
  }

  return false;
}

function hasCryptoRandomUuid(source: string): number | false {
  const match = /\bcrypto\.randomUUID\s*\(/.exec(stripCommentsAndStrings(source));
  return match?.index ?? false;
}

function hasSchemaInstanceof(source: string): number | false {
  const code = stripCommentsAndStrings(source);
  const match = /\binstanceof\s+[A-Z][\w$]*(?:Schema|Request)\b/.exec(code);
  return match?.index ?? false;
}

function hasSchemaStructWithTag(source: string): number | false {
  const match = /\bSchema\.Struct\s*\(\s*{[\s\S]*?_tag\s*:\s*Schema\.Literal\s*\(/.exec(
    stripCommentsAndStrings(source),
  );
  return match?.index ?? false;
}

function hasSchemaUnionOfLiterals(source: string): number | false {
  const match =
    /\bSchema\.Union\s*\(\s*Schema\.Literal\s*\([^)]*\)\s*,\s*Schema\.Literal\s*\(/.exec(
      stripCommentsAndStrings(source),
    );
  return match?.index ?? false;
}

function hasNonDeterministicServiceKey(source: string): number | false {
  const code = stripComments(source);
  const legacyPattern =
    /\bclass\s+([A-Z][\w$]*)\s+extends\s+(?:Context\.Tag|Effect\.Service|Effect\.Tag)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  for (const match of code.matchAll(legacyPattern)) {
    const [, className, key] = match;
    if (className !== key && !key.endsWith(`/${className}`)) {
      return match.index;
    }
  }

  const servicePattern =
    /\bclass\s+([A-Z][\w$]*)\s+extends\s+Effect\.Service\s*<\s*[A-Z][\w$]*\s*>\s*\(\s*\)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  for (const match of code.matchAll(servicePattern)) {
    const [, className, key] = match;
    if (className !== key && !key.endsWith(`/${className}`)) {
      return match.index;
    }
  }

  return false;
}

function hasMultipleProvideChain(source: string): number | false {
  const code = stripCommentsAndStrings(source);
  const match = /\.pipe\s*\([\s\S]*?Effect\.provide\s*\([\s\S]*?Effect\.provide\s*\(/.exec(code);
  return match?.index ?? false;
}

function hasLayerEffectWithScope(source: string): number | false {
  const code = stripCommentsAndStrings(source);
  const match = /\bLayer\.effect\s*\([\s\S]*?\b(?:Scope\.Scope|Scope)\b/.exec(code);
  return match?.index ?? false;
}

function hasNodeBuiltinImport(source: string): number | false {
  const match =
    /\bfrom\s+['"]node:(?:fs|fs\/promises|path|child_process|crypto|stream|http|https)['"]/.exec(
      stripComments(source),
    );
  return match?.index ?? false;
}

function hasGlobalFetch(source: string, context: RuleContext): number | false {
  const code = stripCommentsAndStrings(source);
  if (isConfiguredPath(context, 'adapterLayers')) {
    return false;
  }

  for (const match of code.matchAll(/\bfetch\s*\(/g)) {
    const wrappedFetch = Boolean(effectWrapperStatement(code, match.index));
    if (wrappedFetch) {
      return match.index;
    }
  }

  return false;
}

function hasEffectSucceedWithVoid(source: string): number | false {
  const match = /\bEffect\.succeed\s*\(\s*(?:undefined|void\s+0)?\s*\)/.exec(
    stripCommentsAndStrings(source),
  );
  return match?.index ?? false;
}

function hasMapToVoid(source: string): number | false {
  const match = /\bEffect\.map\s*\(\s*\(\s*\)\s*=>\s*(?:undefined|void\s+0|\{\s*\})\s*\)/.exec(
    stripCommentsAndStrings(source),
  );
  return match?.index ?? false;
}

function hasMapFlatten(source: string): number | false {
  const match =
    /\bEffect\.map\s*\([\s\S]*?\)\s*,\s*Effect\.flatten\b|\bEffect\.map\s*\([\s\S]*?\)\.pipe\s*\(\s*Effect\.flatten\b/.exec(
      stripCommentsAndStrings(source),
    );
  return match?.index ?? false;
}

function effectWrapperStatement(source: string, targetIndex: number): string | undefined {
  const statementStart = Math.max(
    source.lastIndexOf(';', targetIndex) + 1,
    source.lastIndexOf('\n', targetIndex) + 1,
  );
  const statementEnd = findStatementEnd(source, statementStart);
  const statement = source.slice(statementStart, statementEnd + 1);
  return /\bEffect\.(?:promise|tryPromise)\s*\(/.test(statement) ? statement : undefined;
}

function hasDirectPlatformAccess(source: string, context: RuleContext): boolean {
  if (isConfiguredPath(context, 'adapterLayers')) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  for (const match of code.matchAll(
    /\b(?:fetch|readFileSync|writeFileSync|createReadStream)\s*\(/g,
  )) {
    if (!match[0].startsWith('fetch')) {
      return true;
    }

    if (!effectWrapperStatement(code, match.index)) {
      return true;
    }
  }

  return false;
}

const effectStrictSpecs = [
  {
    name: 'effect-no-run-outside-entrypoints',
    message: 'Run Effect programs only from configured entrypoints.',
    check: (source, context) =>
      hasRuntimeCall(source) &&
      !hasExportedRunPromiseApi(source) &&
      !hasRunForkWithoutObserver(source) &&
      !isEffectTestPath(context) &&
      !isConfiguredPath(context, 'entrypoints'),
  },
  {
    name: 'effect-require-platform-runmain-at-entrypoints',
    message: 'Entrypoints should use the platform runMain boundary instead of raw Effect runners.',
    check: (source, context) =>
      isConfiguredPath(context, 'entrypoints') &&
      /Effect\.run(?:Promise|Sync|Fork)/.test(stripCommentsAndStrings(source)),
  },
  {
    name: 'effect-no-runSync-in-server-request-handlers',
    message: 'Server handlers must not synchronously run Effects.',
    check: hasRunSyncInServerRequestHandler,
  },
  {
    name: 'effect-no-promise-returning-public-api',
    message: 'Public APIs should expose Effect return types instead of Promise.',
    check: hasPromiseReturningPublicApi,
  },
  {
    name: 'effect-no-direct-process-env-outside-config-layer',
    message: 'Read process.env only inside the configured Effect Config layer.',
    check: (source, context) =>
      /\bprocess\.env\b/.test(stripCommentsAndStrings(source)) &&
      !hasEffectSignal(source) &&
      !isConfiguredPath(context, 'configLayers'),
  },
  {
    name: 'effect-no-direct-clock-random-outside-adapters',
    message: 'Use Clock and Random services outside configured adapter modules.',
    check: (source, context) =>
      /\b(?:Date\.now|Math\.random)\s*\(/.test(stripCommentsAndStrings(source)) &&
      !hasEffectSignal(source) &&
      !isConfiguredPath(context, 'adapterLayers'),
  },
  {
    name: 'effect-no-direct-http-fs-outside-platform-services',
    message: 'Use Effect platform services for HTTP and filesystem access outside adapters.',
    check: hasDirectPlatformAccess,
  },
  {
    name: 'effect-require-service-class-pattern',
    message: 'Services must use the configured class-based Effect service pattern.',
    patterns: [/Context\.GenericTag(?:<[^>]+>)?\s*\(\s*['"`]/],
  },
  {
    name: 'effect-require-tag-identifier',
    message: 'Service tags require stable identifiers.',
    patterns: [
      /Context\.Tag(?:<[^>]+>)?\s*\(\s*\)/,
      /Context\.GenericTag(?:<[^>]+>)?\s*\(\s*\)/,
      /class\s+[A-Z][\w$]*\s+extends\s+Context\.Tag\s*\(\s*\)/,
    ],
  },
  {
    name: 'effect-no-leaked-service-dependencies',
    message: 'Domain exports must not leak raw service implementation dependencies.',
    check: (source, context) =>
      isConfiguredPath(context, 'domain') && /Layer\.|Live\b/.test(stripCommentsAndStrings(source)),
  },
  {
    name: 'effect-no-duplicate-layer-instances',
    message: 'Do not construct the same Layer multiple times in one module.',
    check: hasDuplicateLayerInstance,
  },
  {
    name: 'effect-require-centralized-provision',
    message: 'Provide layers only from configured composition roots.',
    check: (source, context) =>
      /Effect\.provide|Layer\.provide/.test(stripCommentsAndStrings(source)) &&
      !isConfiguredPath(context, 'compositionRoots'),
  },
  {
    name: 'effect-no-provide-in-domain-modules',
    message: 'Domain modules should declare requirements, not provide concrete layers.',
    check: (source, context) =>
      isConfiguredPath(context, 'domain') &&
      /Effect\.provide|Layer\.provide/.test(stripCommentsAndStrings(source)),
  },
  {
    name: 'effect-require-layer-memoization-constant',
    message:
      'Shared layers should be memoized constants instead of functions that recreate resources.',
    check: hasLayerFactory,
  },
  {
    name: 'effect-require-suspend-for-circular-deps',
    message: 'Circular layer dependencies must be suspended.',
    patterns: [
      /Layer\.(?:effect|scoped)\s*\([\s\S]*?Layer\.(?:effect|scoped)\s*\((?![\s\S]*Effect\.suspend)/,
    ],
  },
  {
    name: 'effect-avoid-layer-explosion',
    message: 'Avoid tiny one-off Layer declarations that fragment dependency wiring.',
    patterns: [
      /const\s+[A-Za-z_$][\w$]*Layer\s*=\s*Layer\.[\s\S]*const\s+[A-Za-z_$][\w$]*Layer\s*=\s*Layer\./,
    ],
  },
  {
    name: 'effect-prefer-succeed-for-static-layers',
    message: 'Use Layer.succeed for static pure services.',
    patterns: [/Layer\.effect\s*\([^,]+,\s*Effect\.succeed\s*\(/],
  },
  {
    name: 'effect-require-scoped-for-resource-layers',
    message: 'Layers that allocate resources must be scoped.',
    check: hasUnscopedResourceLayer,
  },
  {
    name: 'effect-no-service-construction-outside-layer',
    message: 'Construct services inside Layers, not directly in domain or application logic.',
    check: (source, context) =>
      !isConfiguredPath(context, 'adapterLayers') &&
      !isConfiguredPath(context, 'configLayers') &&
      !/Layer\./.test(stripCommentsAndStrings(source)) &&
      /new\s+[A-Z][\w$]*(?:Service|Repo|Client)\s*\(/.test(stripCommentsAndStrings(source)),
  },
  {
    name: 'effect-schema-require-validation-at-input-boundaries',
    message: 'Input boundaries must decode request, command, or message data with Schema.',
    check: hasBoundaryDataWithoutSchema,
  },
  {
    name: 'effect-schema-require-validation-at-output-boundaries',
    message: 'Output boundaries should encode or validate public response data.',
    check: hasOutputBoundaryWithoutSchema,
  },
  {
    name: 'effect-schema-require-http-client-response-schema',
    message: 'HTTP client responses must be decoded with Schema.',
    check: hasHttpClientResponseWithoutSchema,
  },
  {
    name: 'effect-schema-require-http-server-request-schema',
    message: 'HTTP server requests must be decoded with Schema.',
    check: hasHttpServerRequestWithoutSchema,
  },
  {
    name: 'effect-schema-require-config-schema',
    message: 'Configuration modules must decode configuration with Schema.',
    check: (source, context) =>
      isConfiguredPath(context, 'configLayers') &&
      /Config\./.test(stripCommentsAndStrings(source)) &&
      !/Schema\./.test(stripCommentsAndStrings(source)),
  },
  {
    name: 'effect-schema-require-persistence-schema',
    message: 'Persistence boundaries must validate loaded records with Schema.',
    check: hasPersistenceReadWithoutSchema,
  },
  {
    name: 'effect-schema-require-public-command-schema',
    message: 'Public command handlers must declare and use input schemas.',
    check: hasCommandHandlerWithoutSchema,
  },
  {
    name: 'effect-schema-no-unknown-crossing-boundary',
    message: 'unknown values must be decoded before crossing configured boundaries.',
    check: (source) =>
      exportedDeclarationTexts(source).some((declaration) =>
        /\bunknown\b/.test(stripCommentsAndStrings(publicApiDeclarationSignature(declaration))),
      ),
  },
  {
    name: 'effect-require-timeout-on-external-effects',
    message: 'External effects must declare a timeout.',
    check: (source) => hasExternalEffectWithoutTimeout(source),
  },
  {
    name: 'effect-require-retry-policy-for-idempotent-external-effects',
    message: 'Idempotent external effects must declare retry policy deliberately.',
    check: (source) => hasIdempotentExternalEffectWithoutRetry(source),
  },
  {
    name: 'effect-require-schedule-jitter-for-retries',
    message: 'Retry schedules must include jitter.',
    check: hasRetryScheduleWithoutJitter,
  },
  {
    name: 'effect-require-span-external',
    message: 'External effects must declare an observability span.',
    check: (source) => hasExternalEffectWithoutSpan(source),
  },
  {
    name: 'effect-require-semaphore-for-shared-resources',
    message: 'Shared scarce resources must be guarded by Semaphore.',
    check: hasSharedResourceForEachWithoutSemaphore,
  },
  {
    name: 'effect-require-ref-for-shared-mutable-state',
    message: 'Shared mutable state must use Ref, SynchronizedRef, or scoped services.',
    check: hasSharedMutableStateWithoutRef,
  },
  {
    name: 'effect-require-scoped-in-loops',
    message: 'Loops that acquire resources must scope each acquisition.',
    check: hasUnscopedResourceLoop,
  },
  {
    name: 'effect-require-onExit-for-cleanup',
    message: 'Cleanup logic should use onExit so success, failure, and interruption are handled.',
    check: hasEnsuringCleanupWithoutOnExit,
  },
  {
    name: 'effect-require-stream-resource-safety',
    message: 'Streams over resources must be scoped or bracketed.',
    check: hasUnsafeResourceStream,
  },
  {
    name: 'effect-require-stream-termination',
    message: 'Long-running streams must declare termination or shutdown behavior.',
    check: hasUnterminatedLongRunningStream,
  },
  {
    name: 'effect-require-explicit-asyncPush-buffer',
    message: 'Stream.asyncPush must declare an explicit buffer/backpressure policy.',
    check: hasAsyncPushWithoutBuffer,
  },
  {
    name: 'effect-require-batching-for-resolver',
    message: 'RequestResolver implementations should batch requests.',
    check: hasUnbatchedResolver,
  },
  {
    name: 'effect-use-batched-resolver-for-n-plus-one',
    message: 'Potential N+1 data access should use a batched RequestResolver.',
    check: hasNPlusOneWithoutBatchedResolver,
  },
  {
    name: 'effect-prefer-pubsub-for-broadcast',
    message: 'Use PubSub for broadcast semantics instead of manually fanning out queues.',
    patterns: [/Queue\.[\s\S]*?\bsubscribers\b|broadcast\s*\([\s\S]*?Queue\./],
  },
  {
    name: 'effect-require-provided-services-in-tests',
    message: 'Effect tests must provide required services explicitly.',
    check: (source, context) =>
      isEffectTestPath(context) && hasUnprovidedServiceInEffectTest(source),
  },
  {
    name: 'effect-prefer-in-memory-implementations',
    message: 'Unit tests should use in-memory service implementations.',
    check: (source, context) => isUnitTestPath(context) && hasRealTestService(source),
  },
  {
    name: 'effect-no-live-services-in-unit-tests',
    message: 'Live services belong in integration tests, not unit tests.',
    check: (source, context) => isUnitTestPath(context) && hasLiveTestService(source),
  },
  {
    name: 'effect-require-testclock-for-time-code',
    message: 'Tests for time-dependent Effect code should use TestClock.',
    check: (source, context) => isEffectTestPath(context) && hasTimeCodeWithoutTestClock(source),
  },
  {
    name: 'effect-no-test-runtime-leakage',
    message: 'Do not share mutable runtime, layer, or service state across Effect tests.',
    check: (source, context) =>
      isEffectTestPath(context) &&
      /const\s+[A-Za-z_$][\w$]*(?:Runtime|Layer|Service)\s*=/.test(source),
  },
  {
    name: 'effect-no-ad-hoc-effect-wrapper-abstractions',
    message: 'Do not hide Effect semantics behind local wrapper DSLs.',
    patterns: [/function\s+(?:runEffect|makeEffect|effectify|toEffect)\s*\(/],
  },
  {
    name: 'effect-require-effect-suppression-reason-and-ticket',
    message: 'Effect rule suppressions must name a rule, a reason, and a tracking ticket.',
    check: (source) =>
      source.split('\n').some((line) => {
        if (!/(?:eslint|oxlint)-disable[^\n]*effect-/.test(line)) {
          return false;
        }

        return !/(?:reason|because)[^\n]*(?:[A-Z]+-\d+|#\d+)/.test(line);
      }),
  },
  {
    name: 'effect-no-crypto-randomUUID',
    message: 'Use Effect Random or an injected UUID service instead of crypto.randomUUID.',
    check: hasCryptoRandomUuid,
    ast: (context) => ({
      CallExpression(node) {
        if (isMember((node as AstNode).callee, 'crypto', 'randomUUID')) {
          reportAst(
            context,
            'Use Effect Random or an injected UUID service instead of crypto.randomUUID.',
            node,
          );
        }
      },
    }),
  },
  {
    name: 'effect-require-schema-is-over-instanceof',
    message: 'Use Schema.is for schema-modeled domain checks instead of instanceof.',
    check: hasSchemaInstanceof,
    ast: (context) => ({
      BinaryExpression(node) {
        const binary = node as { operator?: string; right?: unknown };
        const rightName = identifierName(binary.right);
        if (
          binary.operator === 'instanceof' &&
          rightName &&
          /(?:Schema|Request)$/.test(rightName)
        ) {
          reportAst(
            context,
            'Use Schema.is for schema-modeled domain checks instead of instanceof.',
            node,
          );
        }
      },
    }),
  },
  {
    name: 'effect-prefer-schema-tagged-struct',
    message: 'Use Schema.TaggedStruct or Schema.TaggedClass instead of Struct with _tag.',
    check: hasSchemaStructWithTag,
    ast: (context, source) => ({
      CallExpression(node) {
        const call = node as { arguments?: unknown[]; callee?: unknown };
        const firstArg = call.arguments?.[0] as { properties?: unknown[] } | undefined;
        if (
          !isSchemaMember(call.callee, source, 'Struct') ||
          nodeType(firstArg) !== 'ObjectExpression'
        ) {
          return;
        }
        const objectArg = firstArg as { properties?: unknown[] };
        if (
          objectArg.properties?.some((property) => {
            const prop = property as { key?: unknown; value?: unknown };
            return (
              identifierName(prop.key) === '_tag' &&
              isSchemaMember((prop.value as AstNode).callee, source, 'Literal')
            );
          })
        ) {
          reportAst(
            context,
            'Use Schema.TaggedStruct or Schema.TaggedClass instead of Struct with _tag.',
            node,
          );
        }
      },
    }),
  },
  {
    name: 'effect-prefer-single-schema-literal-union',
    message: 'Combine literal alternatives into one Schema.Literal call.',
    check: hasSchemaUnionOfLiterals,
    ast: (context, source) => ({
      CallExpression(node) {
        const call = node as { arguments?: unknown[]; callee?: unknown };
        const literalArgCount =
          call.arguments?.filter((argument) =>
            isSchemaMember((argument as AstNode).callee, source, 'Literal'),
          ).length ?? 0;
        if (isSchemaMember(call.callee, source, 'Union') && literalArgCount > 1) {
          reportAst(context, 'Combine literal alternatives into one Schema.Literal call.', node);
        }
      },
    }),
  },
  {
    name: 'effect-require-deterministic-service-keys',
    message: 'Service/tag identifiers must deterministically match the service class.',
    check: hasNonDeterministicServiceKey,
    ast: (context, source) => ({
      ClassDeclaration(node) {
        const { className, key } = serviceKeyFromClass(node as AstNode, source);
        if (className && key && className !== key && !key.endsWith(`/${className}`)) {
          reportAst(
            context,
            'Service/tag identifiers must deterministically match the service class.',
            node,
          );
        }
      },
    }),
  },
  {
    name: 'effect-no-multiple-provide-chain',
    message: 'Avoid chaining Effect.provide calls; compose layers deliberately at the root.',
    check: hasMultipleProvideChain,
  },
  {
    name: 'effect-require-layer-scoped-when-scope-required',
    message: 'Use Layer.scoped when a Layer effect requires Scope.',
    check: hasLayerEffectWithScope,
  },
  {
    name: 'effect-no-node-builtins-when-effect-platform-exists',
    message: 'Use Effect platform services instead of direct Node built-in imports.',
    check: hasNodeBuiltinImport,
    ast: (context) => ({
      ImportDeclaration(node) {
        const sourceValue = literalValue((node as { source?: unknown }).source);
        if (
          !isConfiguredPath(context, 'adapterLayers') &&
          typeof sourceValue === 'string' &&
          /^node:(?:fs|fs\/promises|path|child_process|crypto|stream|http|https)$/.test(sourceValue)
        ) {
          reportAst(
            context,
            'Use Effect platform services instead of direct Node built-in imports.',
            node,
          );
        }
      },
    }),
  },
  {
    name: 'effect-no-global-fetch',
    message: 'Use the Effect HTTP client or an adapter service instead of global fetch.',
    check: hasGlobalFetch,
    ast: (context, source) => ({
      CallExpression(node) {
        const calleeName = identifierName((node as AstNode).callee);
        const wrappedFetch = effectWrapperStatement(
          stripCommentsAndStrings(source),
          (node as { start?: number }).start ?? 0,
        );
        if (calleeName === 'fetch' && !isConfiguredPath(context, 'adapterLayers') && wrappedFetch) {
          reportAst(
            context,
            'Use the Effect HTTP client or an adapter service instead of global fetch.',
            node,
          );
        }
      },
    }),
  },
  {
    name: 'effect-prefer-effect-void',
    message: 'Use Effect.void instead of Effect.succeed(undefined).',
    check: hasEffectSucceedWithVoid,
    ast: (context, source) => ({
      CallExpression(node) {
        const call = node as { arguments?: unknown[]; callee?: unknown };
        const firstArg = call.arguments?.[0];
        if (
          (isEffectMember(call.callee, source, new Set(['succeed'])) ||
            isEffectFunctionCall(call.callee, source, 'succeed')) &&
          (!firstArg || identifierName(firstArg) === 'undefined' || isVoidZero(firstArg))
        ) {
          reportAst(context, 'Use Effect.void instead of Effect.succeed(undefined).', node);
        }
      },
    }),
  },
  {
    name: 'effect-prefer-asVoid',
    message: 'Use Effect.asVoid instead of mapping to undefined or an empty block.',
    check: hasMapToVoid,
  },
  {
    name: 'effect-prefer-flatMap-over-map-flatten',
    message: 'Use Effect.flatMap instead of Effect.map followed by Effect.flatten.',
    check: hasMapFlatten,
  },
] satisfies readonly RuleSpec[];

const effectStrictRules = makeRules(effectStrictSpecs, { schema: strictPathOptionsSchema });

export default effectStrictRules;
