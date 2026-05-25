import { type Context, type RuleSpec, makeRules } from '../../src/rules/effect-rule-core';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const sourceText = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf-8');

const joinedSourceText = (...paths: string[]): string =>
  paths.map((path): string => sourceText(path)).join('\n');

describe('Effect rule core performance invariants', (): void => {
  it('reuses source text across rules that share the same source object', (): void => {
    let getTextCalls = 0;
    const sourceCode = {
      getText() {
        getTextCalls++;
        return 'import { Effect } from "effect";\nEffect.succeed(1);\n';
      },
    };
    const context = {
      report(): void {},
      sourceCode,
    } satisfies Context;
    const specs = [
      {
        message: 'first',
        name: 'first',
        patterns: [/Effect\.succeed/],
      },
      {
        message: 'second',
        name: 'second',
        patterns: [/Effect\.succeed/],
      },
    ] satisfies RuleSpec[];
    const rules = makeRules(specs);

    rules.first.create(context).Program({ type: 'Program' });
    rules.second.create(context).Program({ type: 'Program' });

    expect(getTextCalls).toBe(1);
  });

  it('uses cached line indexes instead of rescanning from the file start for each report', (): void => {
    const source = sourceText('../../src/rules/effect-rule-core.ts');

    expect(source).not.toContain('for (let position = 0; position < index; position++)');
  });

  it('caches global regex variants instead of reallocating them for every file', (): void => {
    const source = sourceText('../../src/rules/effect-rule-core.ts');

    expect(source).toContain('globalPatternCache');
    expect(source).not.toContain('return new RegExp(\n    pattern.source');
  });

  it('caches whole-file Effect signal checks used by AST visitors', (): void => {
    const source = sourceText('../../src/rules/effect-rule-aliases.ts');

    expect(source).toContain('effectSignalCache');
    expect(source).toMatch(/cacheBoolean\(\s*effectSignalCache/);
  });

  it('uses a cheap Effect signal prefilter before stripping or alias parsing', (): void => {
    const source = sourceText('../../src/rules/effect-rule-aliases.ts');

    expect(source).toContain("!source.includes('Effect')");
    expect(source).toContain("!source.includes('effect')");
  });

  it('does not mutate LRU maps on hot cache hits', (): void => {
    const source = joinedSourceText(
      '../../src/rules/effect-rule-core.ts',
      '../../src/rules/effect-rule-aliases.ts',
      '../../src/rules/effect-default-scan-helpers.ts',
      '../../src/rules/effect-default-floating-helpers.ts',
    );

    expect(source).not.toContain('lineStartCache.delete(source)');
    expect(source).not.toContain('cache.delete(source)');
    expect(source).not.toContain('canonicalSourceCache.delete(source)');
  });

  it('does not allocate copied alias arrays on cache hits', (): void => {
    const source = sourceText('../../src/rules/effect-rule-aliases.ts');

    expect(source).not.toContain('return [...cachedValue]');
  });

  it('does not repeat file-level Effect signal checks inside AST visitor hot paths', (): void => {
    const defaultRulesSource = joinedSourceText(
      '../../src/rules/effect-default.ts',
      '../../src/rules/effect-default-env-rules.ts',
      '../../src/rules/effect-default-compat-rules.ts',
    );

    expect(
      defaultRulesSource.match(/const isEffectModule = hasEffectSignal\(source\);/g),
    ).toHaveLength(8);
    expect(defaultRulesSource).not.toContain('hasEffectSignal(source) &&');
    expect(
      (defaultRulesSource.match(/if \(!hasEffectSignal\(source\)\)/g) ?? []).length,
    ).toBeLessThanOrEqual(1);
  });

  it('does not use a bare lowercase effect token that matches React useEffect files', (): void => {
    const defaultRulesSource = joinedSourceText(
      '../../src/rules/effect-default.ts',
      '../../src/rules/effect-default-env-rules.ts',
      '../../src/rules/effect-default-compat-rules.ts',
    );

    expect(defaultRulesSource).not.toContain("'effect',");
  });

  it('caches token gate decisions by shared token array and source', (): void => {
    const source = sourceText('../../src/rules/effect-rule-core.ts');

    expect(source).toContain('tokenGateCache');
    expect(source).toContain('WeakMap<readonly string[], Map<string, boolean>>');
  });

  it('caches individual token presence by source so overlapping rule gates do not rescan files', (): void => {
    const source = sourceText('../../src/rules/effect-rule-core.ts');

    expect(source).toContain('sourceTokenPresenceCache');
    expect(source).toContain('const hasTokenInSourceCached');
    expect(source).toContain('hasTokenInSourceCached(source, token)');
  });

  it('hoists Effect call predicates out of hot CallExpression visitors', (): void => {
    const defaultRulesSource = joinedSourceText(
      '../../src/rules/effect-default-ast.ts',
      '../../src/rules/effect-default.ts',
      '../../src/rules/effect-default-compat-rules.ts',
    );

    expect(defaultRulesSource).toContain('const effectCallPredicate');
    expect(defaultRulesSource).not.toContain("new Set(['fail'])");
    expect(defaultRulesSource).not.toContain("new Set(['fn', 'fnUntraced', 'fnUntracedEager'])");
  });

  it('caches default helper Effect alias patterns and call regexes by source', (): void => {
    const defaultHelpersSource = sourceText('../../src/rules/effect-default-scan-helpers.ts');

    expect(defaultHelpersSource).toContain('effectAliasesPatternCache');
    expect(defaultHelpersSource).toContain('effectCallPatternCache');
    expect(defaultHelpersSource).not.toContain('effectAliasesPatternCache.delete(source)');
    expect(defaultHelpersSource).not.toContain('effectCallPatternCache.delete(source)');
  });

  it('caches floating Effect regex bundles by alias pattern', (): void => {
    const defaultHelpersSource = sourceText('../../src/rules/effect-default-floating-helpers.ts');

    expect(defaultHelpersSource).toContain('floatingEffectPatternCache');
    expect(defaultHelpersSource).toContain('const floatingEffectPatterns');
    expect(defaultHelpersSource).not.toContain('floatingEffectPatternCache.delete(aliasPattern)');
  });

  it('uses per-rule tokens for default AST rules with necessary call syntax', (): void => {
    const defaultRulesSource = joinedSourceText(
      '../../src/rules/effect-default.ts',
      '../../src/rules/effect-default-env-rules.ts',
      '../../src/rules/effect-default-compat-rules.ts',
    );

    expect(defaultRulesSource).toContain("name: 'effect-no-promise-then-in-effect',");
    expect(defaultRulesSource).toContain("tokens: ['.then', '.catch'],");
    expect(defaultRulesSource).toContain("name: 'effect-no-string-errors',");
    expect(defaultRulesSource).toContain("tokens: ['fail'],");
    expect(defaultRulesSource).toContain("name: 'effect-no-untagged-errors',");
  });

  it('uses token groups for Effect.fn IIFE visitor startup', (): void => {
    const defaultRulesSource = sourceText('../../src/rules/effect-default-compat-rules.ts');

    expect(defaultRulesSource).toContain("name: 'effect-no-effect-fn-iife',");
    expect(defaultRulesSource).toContain("tokenGroups: [['fn'], ['Effect', 'effect']],");
  });

  it('uses per-rule tokens for expensive Program-only Effect checks', (): void => {
    const defaultRulesSource = joinedSourceText(
      '../../src/rules/effect-default.ts',
      '../../src/rules/effect-default-env-rules.ts',
      '../../src/rules/effect-default-compat-rules.ts',
    );

    for (const [ruleName, tokenLine] of [
      ['effect-require-yield-star', "tokenGroups: [['gen'], ['yield']],"],
      ['effect-require-return-yield-star', "tokenGroups: [['gen'], ['return']],"],
      ['effect-prefer-gen-for-nested-flatmap', "tokens: ['flatMap'],"],
      ['effect-no-function-returning-gen', "tokens: ['gen'],"],
      ['effect-no-floating-fiber', "tokens: ['fork'],"],
      ['effect-no-run-inside-effect', "tokens: ['run'],"],
      ['effect-no-runpromise-in-exported-api', "tokens: ['runPromise'],"],
      ['effect-no-runfork-without-observer', "tokens: ['runFork'],"],
      ['effect-require-suspend-for-recursion', "tokens: ['function', '=>'],"],
      ['effect-no-effect-in-array-foreach', "tokens: ['forEach'],"],
      ['effect-no-async-await-in-effect', "tokens: ['async', 'await'],"],
      ['effect-no-throw', "tokens: ['throw'],"],
      [
        'effect-schema-no-unsafe-sync-decode-in-effect-code',
        "tokens: ['decodeSync', 'decodeUnknownSync'],",
      ],
      ['effect-schema-no-cast-after-decode', "tokenGroups: [['Schema.decode'], [' as ']],"],
      ['effect-no-deprecated-context-tag-function', "tokens: ['Context.Tag'],"],
      ['effect-prefer-effect-is', "tokens: ['instanceof', '_op'],"],
    ] as const) {
      expect(defaultRulesSource).toContain(`name: '${ruleName}',`);
      expect(defaultRulesSource).toContain(tokenLine);
    }
  });

  it('checks floating Effect lines without splitting the whole source', (): void => {
    const defaultHelpersSource = sourceText('../../src/rules/effect-default-floating-helpers.ts');

    expect(defaultHelpersSource).not.toContain("code.split('\\n')");
  });

  it('uses per-rule tokens for expensive strict Program-only checks', (): void => {
    const strictRulesSource = joinedSourceText(
      '../../src/rules/effect-strict-core-specs.ts',
      '../../src/rules/effect-strict-ast-specs.ts',
    );

    for (const [ruleName, tokenLine] of [
      [
        'effect-schema-require-validation-at-input-boundaries',
        "tokens: ['.body', '.params', '.query', '.payload'],",
      ],
      [
        'effect-schema-require-validation-at-output-boundaries',
        "tokens: ['Response.json', 'return json'],",
      ],
      [
        'effect-schema-require-http-client-response-schema',
        "tokens: ['HttpClient.', 'response.json'],",
      ],
      [
        'effect-schema-require-http-server-request-schema',
        "tokens: ['HttpRouter.', 'HttpServerRequest'],",
      ],
      [
        'effect-schema-require-persistence-schema',
        "tokens: ['db.', 'database.', 'collection.', 'repository.'],",
      ],
      ['effect-schema-require-public-command-schema', "tokens: ['handler'],"],
      [
        'effect-require-timeout-on-external-effects',
        "tokens: ['HttpClient.', 'fetch', 'FileSystem.', 'SqlClient.'],",
      ],
      [
        'effect-require-retry-policy-for-idempotent-external-effects',
        "tokens: ['HttpClient.', 'fetch', 'find', 'lookup', 'read'],",
      ],
      [
        'effect-require-schedule-jitter-for-retries',
        "tokenGroups: [['Effect.retry'], ['Schedule.']],",
      ],
      [
        'effect-require-span-external',
        "tokens: ['HttpClient.', 'fetch', 'FileSystem.', 'SqlClient.'],",
      ],
      ['effect-require-semaphore-for-shared-resources', "tokens: ['Effect.forEach'],"],
      ['effect-require-ref-for-shared-mutable-state', "tokens: ['let '],"],
      ['effect-require-scoped-in-loops', "tokens: ['open', 'connect', 'subscribe', 'listen'],"],
      ['effect-require-onExit-for-cleanup', "tokens: ['Effect.ensuring', 'cleanup'],"],
      ['effect-use-batched-resolver-for-n-plus-one', "tokens: ['Effect.forEach'],"],
      ['effect-require-provided-services-in-tests', "tokens: ['Service', 'Repo', 'Client'],"],
      ['effect-prefer-in-memory-implementations', "tokens: ['real'],"],
      ['effect-no-live-services-in-unit-tests', "tokens: ['Live', 'Layer.live'],"],
      [
        'effect-require-testclock-for-time-code',
        "tokens: ['Effect.timeout', 'Effect.delay', 'Clock.'],",
      ],
    ] as const) {
      expect(strictRulesSource).toContain(`name: '${ruleName}',`);
      expect(strictRulesSource).toContain(tokenLine);
    }
  });

  it('uses identifier tokens for default environment escape-hatch AST rules', (): void => {
    const defaultRulesSource = joinedSourceText(
      '../../src/rules/effect-default.ts',
      '../../src/rules/effect-default-env-rules.ts',
      '../../src/rules/effect-default-compat-rules.ts',
    );

    expect(defaultRulesSource).toContain("tokens: ['console'],");
    expect(defaultRulesSource).toContain("tokens: ['process'],");
    expect(defaultRulesSource).toContain("tokens: ['Date'],");
    expect(defaultRulesSource).toContain("tokens: ['Math'],");
    expect(defaultRulesSource).toContain("tokenGroups: [['Promise'], ['Effect', 'effect']],");
    expect(defaultRulesSource).toContain(
      "tokens: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],",
    );
    expect(defaultRulesSource).toContain("tokens: ['Error'],");
  });

  it('lets individual rules skip canonicalization when required tokens are absent', (): void => {
    let checks = 0;
    const context = {
      report(): void {},
      sourceCode: {
        text: 'const value = 1;\n',
      },
    } satisfies Context;
    const rules = makeRules([
      {
        check() {
          checks++;
          return false;
        },
        message: 'token gated',
        name: 'token-gated',
        tokens: ['Effect.'],
      },
    ]);

    rules['token-gated']?.create(context).Program({ type: 'Program' });

    expect(checks).toBe(0);
  });

  it('supports shared default tokens for a whole rule bucket', (): void => {
    let checks = 0;
    const context = {
      report(): void {},
      sourceCode: {
        text: 'const value = 1;\n',
      },
    } satisfies Context;
    const rules = makeRules(
      [
        {
          check() {
            checks++;
            return false;
          },
          message: 'bucket gated',
          name: 'bucket-gated',
        },
      ],
      { defaultTokens: ['Effect.'] },
    );

    rules['bucket-gated']?.create(context).Program({ type: 'Program' });

    expect(checks).toBe(0);
  });

  it('does not attach AST visitors when shared default tokens are absent', (): void => {
    let astFactories = 0;
    const context = {
      report(): void {},
      sourceCode: {
        text: 'const value = 1;\n',
      },
    } satisfies Context;
    const rules = makeRules(
      [
        {
          ast() {
            astFactories++;
            return {
              CallExpression(): void {},
            };
          },
          message: 'ast gated',
          name: 'ast-gated',
        },
      ],
      { defaultTokens: ['Effect.'] },
    );

    const visitors = rules['ast-gated']?.create(context);

    expect(astFactories).toBe(0);
    expect(visitors?.CallExpression).toBeUndefined();
  });

  it('uses Oxlint createOnce for Program-only Effect rules', (): void => {
    const rules = makeRules([
      {
        message: 'program only',
        name: 'program-only',
        patterns: [/Effect\.succeed/],
      },
      {
        ast: (): Record<string, (node: object) => void> => ({
          CallExpression(): void {},
        }),
        message: 'ast rule',
        name: 'ast-rule',
      },
    ]);

    expect(rules['program-only']?.createOnce).toBeTypeOf('function');
    expect(rules['ast-rule']?.createOnce).toBeUndefined();
  });

  it('skips Program-only createOnce rules in before when required tokens are absent', (): void => {
    let checks = 0;
    const context = {
      report(): void {},
      sourceCode: {
        text: 'const value = 1;\n',
      },
    } satisfies Context;
    const rules = makeRules(
      [
        {
          check() {
            checks++;
            return false;
          },
          message: 'bucket gated',
          name: 'bucket-gated',
        },
      ],
      { defaultTokens: ['Effect.'] },
    );
    const visitors = rules['bucket-gated']?.createOnce?.(context);

    expect(visitors?.before?.()).toBe(false);
    visitors?.Program?.({ type: 'Program' });

    expect(checks).toBe(0);
  });

  it('lets rules require one token from every token group before creating visitors', (): void => {
    let factories = 0;
    const context = {
      report(): void {},
      sourceCode: {
        text: 'export function load(): Promise<number> { return fetchNumber(); }\n',
      },
    } satisfies Context;
    const rules = makeRules([
      {
        ast: (): Record<string, (node: object) => void> => {
          factories++;
          return {
            NewExpression(): void {},
          };
        },
        message: 'avoid new Promise',
        name: 'avoid-new-promise',
        tokenGroups: [['Promise'], ['Effect', 'effect']],
      },
    ]);

    rules['avoid-new-promise']?.create(context).Program({ body: [], type: 'Program' });

    expect(factories).toBe(0);
  });
});
