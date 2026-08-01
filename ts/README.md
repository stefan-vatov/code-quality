# @thethracian/oxlint-config

<p align="center">
  <a href="https://www.npmjs.com/package/@thethracian/oxlint-config"><img alt="npm version" src="https://img.shields.io/npm/v/@thethracian/oxlint-config?style=flat-square"></a>
  <a href="https://www.npmjs.com/package/@thethracian/oxlint-config"><img alt="npm downloads" src="https://img.shields.io/npm/dw/@thethracian/oxlint-config?style=flat-square"></a>
  <a href="https://socket.dev/npm/package/%40thethracian/oxlint-config"><img alt="Socket package analysis" src="https://socket.dev/api/badge/npm/package/@thethracian/oxlint-config"></a>
  <a href="https://github.com/stefan-vatov/code-quality/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/stefan-vatov/code-quality/ci.yml?branch=main&style=flat-square"></a>
  <a href="https://github.com/stefan-vatov/code-quality/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
</p>

The Thracian Oxlint config is an experimental, painfully strict, very opinionated TypeScript lint profile for teams that want AI-generated code reviewed like production code.

```text
oxlint.config.mjs
  import theThracian from '@thethracian/oxlint-config';

  export default theThracian({ typeAware: true });

Result: native Oxlint rules + The Thracian custom rules + optional Effect policy checks.
```

## Why Use It

- Strict by default: every rule is an error, not a suggestion.
- Agent-ready TypeScript: catches debug artifacts, unsafe escape hatches, silent catches, mutation, deep nesting, and oversized code.
- Effect-aware out of the box: 95 always-on Effect rules target lazy values, generator style, Promise boundaries, typed errors, Schema boundaries, resources, tests, and common hallucinated APIs.
- Strict Effect mode when you want it: opt in to 60 additional project-boundary rules for entrypoints, adapters, config layers, domain modules, service wiring, external calls, and test ownership.
- Importable config: consumers import one package instead of copying linter files around a codebase.

## Install

```sh
pnpm add -D @thethracian/oxlint-config oxlint@^1.63.0
```

Create `oxlint.config.mjs`:

```js
import theThracian from '@thethracian/oxlint-config';

export default theThracian();
```

Run Oxlint:

```sh
pnpm oxlint .
```

Add package scripts for normal linting, type-aware linting, and the combined fixer:

```json
{
  "scripts": {
    "lint": "oxlint src",
    "lint:fix": "thx-codemod-fix src && oxlint src --fix && thx-codemod-fix src",
    "lint:type-aware": "oxlint src --type-aware --type-check",
    "lint:fix:type-aware": "thx-codemod-fix src && oxlint src --type-aware --type-check --fix && thx-codemod-fix src"
  }
}
```

`thx-codemod-fix` is intentionally separate from `oxlint --fix` because Oxlint owns native rule fixes and the package CLI owns larger AST codemods. Running it before and after Oxlint is safe because the codemods are idempotent. The CLI defaults to `src`, but you can pass any files or directories your project wants fixed.

For staged files, wire the same package tools through `lint-staged`:

```json
{
  "lint-staged": {
    "*.{ts,tsx,mts,cts}": [
      "thx-codemod-fix",
      "oxlint --type-aware --type-check --fix --no-error-on-unmatched-pattern",
      "thx-codemod-fix"
    ]
  }
}
```

Programmatic consumers can use the same codemod runner:

```ts
import { codemodFix } from '@thethracian/oxlint-config/codemod-fix';

codemodFix({
  paths: ['src', 'scripts'],
});
```

## Type-Aware Mode

Type-aware mode enables Oxlint's semantic TypeScript checks and the matching strict rules from this config.

```js
import theThracian from '@thethracian/oxlint-config';

export default theThracian({
  typeAware: true,
});
```

Use this when you want checks such as unsafe calls, unsafe member access, floating promises, misused promises, and exhaustive switch handling. It is slower than syntax-only linting because Oxlint has to load TypeScript project information.

## Effect Defaults

Effect rules are enabled by default. They are designed for codebases where agents may produce plausible-looking but semantically weak Effect code.

The default bucket checks for patterns such as:

- floating `Effect` values that are never run, yielded, returned, or composed
- missing `yield*` inside `Effect.gen`
- nested `flatMap` code that should be `Effect.gen`
- `flatMap` callbacks that only lift one value with `Effect.succeed` and should use `Effect.map`
- eager recursive Effect construction that needs `Effect.suspend`; ordinary `flatMap`, `map`, `gen`, and `Effect.fn` continuations remain deferred, while v4 `*Eager` continuations are analyzed as immediate execution
- string errors and untagged error channels
- unsafe Promise, throw, runtime, and sync boundaries, including provably invoked local helpers, executed defaults, and eager collection callbacks
- Schema decode misuse at external data boundaries
- resource, fiber, stream, concurrency, and test determinism mistakes
- deprecated or invented Effect APIs

`effect-prefer-map-over-flatMap-succeed` is import-aware and AST-backed. It recognizes root `Effect` imports, `effect/Effect` namespace imports, and aliased named `flatMap`/`succeed` imports across pipeable, `pipe`, data-first, and data-last composition. It reports only non-async, non-generator arrow or function callbacks whose entire body directly returns a single-argument `Effect.succeed` call, and it ignores unrelated lookalikes and lexically shadowed bindings.

`effect-prefer-andThen-over-flatMap-discarded-value` is always on and reports exact import-aware data-first or pipeable `Effect.flatMap` calls with a zero-parameter arrow callback. It recommends `Effect.andThen` while preserving that callback unchanged, recognizes aliases, respects lexical shadowing, and is report-only. The rule is limited to the type-valid Effect-returning common subset shared by Effect 3.21 and Effect v4, whose implementations preserve the callback-based sequencing contract ([v3 source](https://github.com/Effect-TS/effect/blob/39c934c1476be389f7469433910fdf30fc4dad82/packages/effect/src/internal/core.ts#L746-L804), [v4 source](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/internal/effect.ts#L1402-L1424)). Classic function callbacks are excluded because Effect v3 can expose different dynamic `this` and `arguments` values through the two combinators. It never rewrites the callback to `andThen(nextEffectExpression)` because constructing the next Effect earlier can change timing. The mined corpus contains 114 zero-parameter `flatMap` targets across 80 files in 16 repositories and 917 canonical `Effect.andThen` calls, including 101 zero-parameter callback uses:

- Effect Build Utils v3 `scripts/copy-package-json.ts` ([source](https://github.com/Effect-TS/build-utils/blob/c3ad61ee9f2b5b5142e5799931b4f0eac3772da2/scripts/copy-package-json.ts#L37-L40))
- Typed v3 `packages/fx/src/Pull.ts` ([source](https://github.com/TylorS/typed/blob/3b44be752873fb43497539783e47ffc642411182/packages/fx/src/Pull.ts#L42-L45))
- Effect MCP v4 `scripts/copy-package-json.ts` ([source](https://github.com/tim-smart/effect-mcp/blob/83a768303839b9e125f6c286369a5d9cc26c666e/scripts/copy-package-json.ts#L38-L41))
- T3 Code v4 `apps/server/src/serverRuntimeStartup.ts` ([source](https://github.com/pingdotgg/t3code/blob/b41e89eba9cd232cc3257b400fc30972a9b53438/apps/server/src/serverRuntimeStartup.ts#L121-L125))
- Distilled v4 `packages/aws/test/services/kinesis.test.ts` ([source](https://github.com/alchemy-run/distilled/blob/d9fa6d104839dce6606f069205165c10b0cdd737/packages/aws/test/services/kinesis.test.ts#L55-L61))

`effect-prefer-filterOrFail-over-flatMap-guard` is always on, import-aware, and report-only. It recognizes exact data-first and pipeable `flatMap` guards whose single-parameter arrow returns `predicate ? Effect.succeed(parameter) : Effect.fail(error)`, including a sole `return` statement. For equivalent narrowing in Effect 3.21.2 and Effect v4 beta.101, the predicate is limited to strict equality, inequality, or relational comparisons between a literal and the parameter or a static property path rooted at it; `typeof path ===/!== "type"`; and `"property" in path`. The error must be independent of the parameter and remains in a lazy error callback. Predicates using outer identifiers, optional or computed members, calls, compound conditions, `instanceof`, or classic functions are excluded because they can change cross-version narrowing or runtime semantics. The shared contract was verified against the [v3 API](https://github.com/Effect-TS/effect/blob/39c934c1476be389f7469433910fdf30fc4dad82/packages/effect/src/Effect.ts#L8418-L8492), [v3 implementation](https://github.com/Effect-TS/effect/blob/39c934c1476be389f7469433910fdf30fc4dad82/packages/effect/src/internal/core-effect.ts#L651-L694), [v4 API](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/Effect.ts#L5160-L5223), and [v4 implementation](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/internal/effect.ts#L2293-L2336). The final mined target contains 5 calls in 3 files across 3 repositories, while the broader canonical signal contains 22 examples in 17 files across 9 repositories:

- Effect Stream `n <= 2` ([source](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/test/Stream.test.ts#L3971-L3982))
- Distilled S3 `r.Status === "Enabled"` ([source](https://github.com/alchemy-run/distilled/blob/d9fa6d104839dce6606f069205165c10b0cdd737/packages/aws/test/services/s3.test.ts#L925-L961))
- Distilled S3 `r.Status === "Suspended"` ([source](https://github.com/alchemy-run/distilled/blob/d9fa6d104839dce6606f069205165c10b0cdd737/packages/aws/test/services/s3.test.ts#L925-L961))
- T3 Code archived-thread guard `thread.archivedAt !== null` ([source](https://github.com/pingdotgg/t3code/blob/b41e89eba9cd232cc3257b400fc30972a9b53438/apps/server/src/orchestration/commandInvariants.ts#L116-L151))
- T3 Code non-archived-thread guard `thread.archivedAt === null` ([source](https://github.com/pingdotgg/t3code/blob/b41e89eba9cd232cc3257b400fc30972a9b53438/apps/server/src/orchestration/commandInvariants.ts#L116-L151))

`effect-prefer-catchIf-over-conditional-catch` is always on, import-aware, and report-only. It reports exact data-first or pipeable Effect v3 `catchAll` and Effect v4 `catch` calls whose single-identifier, expression-bodied arrow handler uses a conditional expression with exactly one direct `Effect.fail` of that same error. `Effect.catchIf` states the recovery predicate directly and, on a nonmatch, preserves the original cause rather than rebuilding a failure from its typed error. The matcher recognizes root and subpath aliases, respects lexical shadowing, and rejects block or classic-function handlers, wrappers, computed or optional calls, explicit generics, spreads, arity changes, and re-fails of any other expression. Type and runtime probes against Effect 3.21.2 and Effect v4 beta.101 preserved handled failures, unmatched failures, and defects; the corresponding implementations re-fail the original cause in both [v3](https://github.com/Effect-TS/effect/blob/39c934c1476be389f7469433910fdf30fc4dad82/packages/effect/src/internal/core.ts#L613-L626) and [v4](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/internal/effect.ts#L2774-L2789). After removing the `effect-smol` mirror, the mined corpus contains 15 exact conditional-catch targets across five repositories and 99 canonical `catchIf` calls across twelve repository groups:

- Birdclaw v3 conditional file-not-found recovery ([source](https://github.com/steipete/birdclaw/blob/3c173a7e706a35087d7fa14cad198bef03119108/src/lib/backup.ts#L963-L972))
- Official Effect v4 HTTP middleware recovery ([source](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/unstable/httpapi/HttpApiMiddleware.ts#L436-L444))
- Effect Native v4 graph error refinement ([source](https://github.com/effect-native/effect-native/blob/df994cc632071e80ab78280400573586258aed3e/packages/graph-db/src/GraphDb.ts#L51-L62))
- T3 Code v4 existing-file recovery ([source](https://github.com/pingdotgg/t3code/blob/b41e89eba9cd232cc3257b400fc30972a9b53438/packages/shared/src/relayClient.ts#L329-L339))
- Confect v3 canonical parse-error recovery ([source](https://github.com/rjdellecese/confect/blob/de717afe30b5814fb309ed9438a177b6becad8e5/packages/server/src/Document.ts#L102-L112))

`effect-prefer-all-discard` is always on, import-aware, and report-only. It reports only an exact one-argument `Effect.all([...])` call whose input is an array literal without spreads and whose delegated `yield*` is the whole ignored expression statement inside a direct, inline, unannotated, zero-parameter `Effect.gen(function* () {})` callback. It recommends `{ discard: true }` so `Effect.all` does not collect values that the generator immediately discards. The matcher recognizes aliases, respects lexical shadowing, and rejects consumed results, extra arguments, explicit generics, nested or stored generators, and named, parameterized, or annotated callbacks. Type and runtime probes against Effect 3.21.2 and Effect v4 beta.101 proved the literal-array transformation preserves execution and the generator's result; the corresponding discard paths are visible in the [v3 implementation](https://github.com/Effect-TS/effect/blob/39c934c1476be389f7469433910fdf30fc4dad82/packages/effect/src/internal/fiberRuntime.ts#L1966-L1993) and [v4 implementation](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/internal/effect.ts#L4327-L4367). Arbitrary identifiers, calls, and records are excluded because identifiers and calls may produce records, and v4's no-discard record path suspends `Object.entries` while its discard path eagerly calls `Object.values`, which can move getters or proxy traps from Effect execution to Effect construction. The mined corpus contains 4 exact targets across 4 files in 2 repositories, alongside 69 canonical discard calls across 34 files in 9 repositories:

- LiveStore single-tab adapter ([source](https://github.com/livestorejs/livestore/blob/383ad1b27744a22055872ef3359e4fb9b7534852/packages/%40livestore/adapter-web/src/single-tab/single-tab-adapter.ts#L487-L494))
- LiveStore persisted adapter ([source](https://github.com/livestorejs/livestore/blob/383ad1b27744a22055872ef3359e4fb9b7534852/packages/%40livestore/adapter-web/src/web-worker/client-session/persisted-adapter.ts#L632-L640))
- Sync Engine Web server sync authorization ([source](https://github.com/typeonce-dev/sync-engine-web/blob/956aaa9cec0fe1d20ec5cf7d2374285f4e08385d/apps/server/src/group/sync-auth.ts#L51))
- Sync Engine Web client synchronization ([source](https://github.com/typeonce-dev/sync-engine-web/blob/956aaa9cec0fe1d20ec5cf7d2374285f4e08385d/packages/client-lib/src/services/sync.ts#L83-L94))

`effect-prefer-forEach-discard` is always on, import-aware, and report-only. It reports data-first `Effect.forEach(iterable, callback[, options])` only when the call is directly delegated by `yield*` as an ignored expression inside a direct, unannotated `Effect.gen(function* () {})` callback. Adding `{ discard: true }` then avoids collecting an array that the generator immediately discards. The matcher accepts absent options or a plain object containing only `concurrency` and the v3-only `batching` or `concurrentFinalizers` controls. It rejects consumed results, data-last calls, explicit generics, nested generators, annotated callbacks, existing `discard`, and options with spreads, accessors, methods, computed or unknown keys. Type and runtime probes against Effect 3.21.2 and Effect v4 beta.101 preserved errors, defects, interruption, finalizers, callback order, concurrency, and the generator's `void` result. The exact mined pattern contains 72 calls across 34 files in 10 repositories, alongside 119 canonical `{ discard: true }` calls across 74 files in 17 repositories:

- Effect v3 implementation skips sequential result writes when `discard` is enabled ([source](https://github.com/Effect-TS/effect/blob/39c934c1476be389f7469433910fdf30fc4dad82/packages/effect/src/internal/core.ts#L918-L959))
- Effect v4 implementation shares the same sequential and concurrent discard path ([source](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/internal/effect.ts#L4592-L4666))
- AnswerOverflow v3 indexing traversal ([source](https://github.com/AnswerOverflow/AnswerOverflow/blob/f2f443f3c01a67d0e98dbdd1443f9519dd21251b/apps/discord-bot/src/services/indexing.ts#L458-L465))
- Confect v3 code generation traversal ([source](https://github.com/rjdellecese/confect/blob/de717afe30b5814fb309ed9438a177b6becad8e5/packages/cli/src/confect/codegen.ts#L254-L263))
- Effect Native v4 CDP traversal ([source](https://github.com/effect-native/effect-native/blob/df994cc632071e80ab78280400573586258aed3e/packages/debug/src/internal/Cdp.ts#L77-L84))
- T3 Code v4 desktop traversal ([source](https://github.com/pingdotgg/t3code/blob/b41e89eba9cd232cc3257b400fc30972a9b53438/apps/desktop/src/app/DesktopApp.ts#L267-L274))
- Official Effect v4 metric test traversal ([source](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/test/Metric.test.ts#L451-L461))

`effect-prefer-collection-discard-over-asVoid` is always on, import-aware, and report-only. It reports an exact direct `Effect.all` or `Effect.forEach` call followed by the sole pipe operator `Effect.asVoid`, recommending collection discard mode so values are never collected before being discarded. Its conservative boundary is shared by Effect 3.21.2 and Effect v4 beta.101: `Effect.all` requires a direct array literal without spreads; `Effect.forEach` accepts any iterable with no options, empty options, or only `concurrentFinalizers`, but requires a direct spread-free array literal when `concurrency` or `batching` is present. Options must be a plain static object containing only the supported collection controls, with no existing `discard`, spreads, accessors, methods, computed keys, unknown keys, or duplicate keys. The matcher recognizes root and subpath aliases, respects lexical shadowing, and rejects optional calls, explicit generics, wrappers, extra pipe operators, and other consumed results. The final mined corpus contains 6 targets across 3 files in 2 Effect v4 repositories, supported by 188 canonical discard calls across 99 files:

- Hazel gateway shutdown, first collection ([source](https://github.com/HazelChat/hazel/blob/f033d6058021f0cac6a4e461c902122eab32ed91/apps/bot-gateway/src/index.ts#L49-L53))
- Hazel gateway shutdown, second collection ([source](https://github.com/HazelChat/hazel/blob/f033d6058021f0cac6a4e461c902122eab32ed91/apps/bot-gateway/src/index.ts#L55-L61))
- T3 Code provider cleanup traversal ([source](https://github.com/pingdotgg/t3code/blob/b41e89eba9cd232cc3257b400fc30972a9b53438/apps/server/src/provider/Layers/ProviderService.ts#L1024-L1031))
- T3 Code provider directory traversal ([source](https://github.com/pingdotgg/t3code/blob/b41e89eba9cd232cc3257b400fc30972a9b53438/apps/server/src/provider/Layers/ProviderService.ts#L1032))
- T3 Code ingestion traversal ([source](https://github.com/pingdotgg/t3code/blob/b41e89eba9cd232cc3257b400fc30972a9b53438/apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts#L1768-L1780))

`effect-prefer-succeed-for-stable-values` reports `Effect.sync` thunks that only return a literal or an already-initialized `const` from the same execution context. It is import-aware and deliberately preserves calls, getters, allocations, mutable or imported bindings, throwing blocks, and reads whose initialization does not dominate Effect construction. The rule was mined from these concrete Effect codebases:

- Effect `packages/effect/src/unstable/rpc/RpcServer.ts` ([source](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/unstable/rpc/RpcServer.ts#L1107))
- Effect `packages/effect/test/unstable/cli/LogLevel.test.ts` ([source](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/test/unstable/cli/LogLevel.test.ts#L37))
- Effect Solutions `tests/08-testing.test.ts` ([source](https://github.com/kitlangton/effect-solutions/blob/09f82e6c5c928e7232cd32daf04d7c6a830b63f7/tests/08-testing.test.ts#L181))
- Effect Native `packages/bun-test/test/index.test.ts` ([source](https://github.com/effect-native/effect-native/blob/df994cc632071e80ab78280400573586258aed3e/packages/bun-test/test/index.test.ts#L49))
- T3 Code `packages/effect-codex-app-server/src/_internal/shared.ts` ([source](https://github.com/pingdotgg/t3code/blob/b41e89eba9cd232cc3257b400fc30972a9b53438/packages/effect-codex-app-server/src/_internal/shared.ts#L48))

`effect-prefer-succeedNone` is always on and reports `Effect.succeed(Option.none())` in favor of the purpose-built `Effect.succeedNone`. The import-aware matcher recognizes aliases while respecting lexical shadowing. It deliberately preserves explicit type arguments and TypeScript wrapper expressions when replacing them could change inference or type safety. The rule supports both Effect 3.21 and Effect v4 and was mined from these concrete sources:

- Effect `packages/effect/src/Effect.ts` API ([source](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/Effect.ts#L1027-L1044))
- Effect `packages/effect/src/SchemaGetter.ts` ([source](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/SchemaGetter.ts#L606))
- Effect VS Code extension `src/DebugBreakpointsProvider.ts` ([source](https://github.com/Effect-TS/vscode-extension/blob/c49b1c29e8343b282c025d838176758d59ee36af/src/DebugBreakpointsProvider.ts#L116))
- Effect Solutions `packages/cli/src/update-notifier.ts` ([source](https://github.com/kitlangton/effect-solutions/blob/09f82e6c5c928e7232cd32daf04d7c6a830b63f7/packages/cli/src/update-notifier.ts#L50-L52))
- Typed `packages/fx/src/RefSubject.ts` ([source](https://github.com/TylorS/typed/blob/3b44be752873fb43497539783e47ffc642411182/packages/fx/src/RefSubject.ts#L834))

`effect-prefer-succeedSome` is always on and reports `Effect.succeed(Option.some(value))` in favor of `Effect.succeedSome(value)`. Its import-aware matcher recognizes aliases while respecting lexical shadowing, and it preserves explicit generic arguments and TypeScript wrappers around the inner call for type safety. The rule supports both Effect 3.21 and Effect v4; the mined corpus contains 158 verbose targets and 35 canonical uses:

- Effect v4 `succeedSome` API ([source](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/Effect.ts#L1054))
- Effect 3.21 identical internal implementation ([source](https://github.com/Effect-TS/effect/blob/39c934c1476be389f7469433910fdf30fc4dad82/packages/effect/src/internal/core-effect.ts#L1400))
- Effect `SchemaGetter.ts`: [canonical use](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/SchemaGetter.ts#L122) and [verbose target](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/SchemaGetter.ts#L459)
- Typed: [verbose target](https://github.com/TylorS/typed/blob/3b44be752873fb43497539783e47ffc642411182/packages/fx/src/internal/core.ts#L2226) and [canonical use](https://github.com/TylorS/typed/blob/3b44be752873fb43497539783e47ffc642411182/packages/router/src/Matcher.ts#L218)
- T3 Code: [verbose target](https://github.com/pingdotgg/t3code/blob/b41e89eba9cd232cc3257b400fc30972a9b53438/apps/server/src/persistence/Layers/ProjectionCheckpoints.ts#L194) and [canonical use](https://github.com/pingdotgg/t3code/blob/b41e89eba9cd232cc3257b400fc30972a9b53438/apps/server/src/bootstrap.ts#L123)

`effect-prefer-asSome` is always on and reports direct imported `Effect.map(effect, Option.some)` and pipeable `Effect.map(Option.some)` calls in favor of `Effect.asSome`. The matcher is import-aware, recognizes aliases, and respects lexical shadowing. It supports both Effect 3.21 and Effect v4 and deliberately provides no autofix so projects can preserve their chosen import style. The mined corpus contains 39 exact verbose sites (2 official, 9 maintainer, and 28 exemplar) and 47 canonical `asSome` references (30 official, 14 maintainer, 2 exemplar, and 1 language-service fixture):

- Effect v4 `asSome` API and canonical example ([source](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/Effect.ts#L2450-L2466))
- Effect v4 exact `map(Option.some)` implementation ([source](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/internal/effect.ts#L1388-L1391))
- Effect 3.21 exact `map(Option.some)` implementation ([source](https://github.com/Effect-TS/effect/blob/39c934c1476be389f7469433910fdf30fc4dad82/packages/effect/src/internal/core-effect.ts#L74-L79))
- Effect v4 `packages/effect/src/unstable/cluster/Reply.ts` verbose target ([source](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/unstable/cluster/Reply.ts#L457))
- Typed `packages/fx/src/internal/effect-operator.ts` verbose target ([source](https://github.com/TylorS/typed/blob/3b44be752873fb43497539783e47ffc642411182/packages/fx/src/internal/effect-operator.ts#L88))

`effect-prefer-as-over-map-constant` is always on and reports imported data-first or pipeable `Effect.map` calls whose synchronous zero-argument expression callback returns a primitive literal, static template, or unary numeric literal, optionally parenthesized or asserted `as const`; it recommends `Effect.as`. The rule supports Effect 3.21 and Effect v4 and deliberately provides no autofix. Allocations, calls, and identifiers are excluded because `Effect.as` captures its replacement at construction while a `map` callback evaluates after a successful Effect. The non-mirrored mined corpus contains 44 exact targets (1 official, 8 maintainer, and 35 exemplar) alongside 381 canonical `as` uses:

- Effect v4 official verbose target ([source](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/vitest/test/index.test.ts#L82))
- Visual Effect v3 maintainer verbose target ([source](https://github.com/kitlangton/visual-effect/blob/2f910e4a2fe2910ed6f6f550e7531ca5afe73e94/src/examples/effect-validate.tsx#L144))
- T3 Code v4 exemplar verbose target ([source](https://github.com/pingdotgg/t3code/blob/b41e89eba9cd232cc3257b400fc30972a9b53438/apps/server/src/sourceControl/SourceControlRepositoryService.ts#L251))
- Typed v3 canonical use ([source](https://github.com/TylorS/typed/blob/3b44be752873fb43497539783e47ffc642411182/packages/fx/src/internal/effect-operator.ts#L248))
- Effect v4 official canonical use ([source](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/FileSystem.ts#L783))

`effect-prefer-mapBoth` is always on and reports adjacent imported `Effect.map` and `Effect.mapError` stages, in either order, in ordinary `.pipe(...)` chains and exact nested data-first calls. It recommends the shared Effect v3/v4 `Effect.mapBoth` API, which represents both channel transformations with one Effect stage. The matcher recognizes aliases, respects lexical shadowing, reports non-overlapping pairs, and deliberately provides no autofix so callback expressions can retain their original JavaScript evaluation order. The rule was mined from these concrete sources:

- Effect v3.21 and Effect v4 expose the same `mapBoth` contract ([v3 source](https://github.com/Effect-TS/effect/blob/39c934c1476be389f7469433910fdf30fc4dad82/packages/effect/src/Effect.ts#L10026-L10100), [v4 source](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/Effect.ts#L3630-L3638))
- Effect Docgen v3 uses canonical `mapBoth` for adjacent success/error normalization ([source](https://github.com/Effect-TS/docgen/blob/bcc9c14f91c8466ee611bddb36f9e05ed7932166/src/Parser.ts#L541-L559))
- Effect v4 EventJournal contains an adjacent `map` then `mapError` target ([source](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/unstable/eventlog/SqlEventJournal.ts#L209-L214))
- T3 Code v4 contains the reverse `mapError` then `map` target ([source](https://github.com/pingdotgg/t3code/blob/b41e89eba9cd232cc3257b400fc30972a9b53438/apps/web/src/connection/storage.ts#L470-L476))
- Effect AWS v3 contains an adjacent `map` then `mapError` target ([source](https://github.com/floydspace/effect-aws/blob/0dfe6cb7d6a74890b7fb5aeeaece09daa67788c1/packages/s3/src/internal/s3FileSystem.ts#L119-L126))

`effect-prefer-tap-over-flatMap-as` is always on and reports imported data-first or pipeable `Effect.flatMap` calls only when their single-parameter callback's entire body returns imported `Effect.as(sideEffect, originalBinding)` or `sideEffect.pipe(Effect.as(originalBinding))`. It recommends `Effect.tap`, uses a diagnostic-only import-aware matcher, recognizes aliases, and respects lexical shadowing. The exact Effect-returning pattern is equivalent in Effect v3.21 and v4; the rule deliberately excludes the plain-value and `PromiseLike` callbacks accepted only by v3 `Effect.tap`. The mined corpus contains 3 exact verbose targets alongside 507 canonical `Effect.tap` AST call sites:

- Effect v3.21 implements the Effect-returning `tap` branch as `flatMap` followed by `as` ([source](https://github.com/Effect-TS/effect/blob/39c934c1476be389f7469433910fdf30fc4dad82/packages/effect/src/internal/core.ts#L1222-L1290))
- Effect v4 implements `tap` as `flatMap` followed by `as` ([source](https://github.com/Effect-TS/effect/blob/ed2afb3424e90f3b98a6e4740f4e12cc08e3cc11/packages/effect/src/internal/effect.ts#L1427-L1449))
- Birdclaw v3 contains an exact `flatMap` plus pipeable `as` target ([source](https://github.com/steipete/birdclaw/blob/3c173a7e706a35087d7fa14cad198bef03119108/src/lib/mention-threads-live.ts#L710-L722))
- T3 Code v4 contains an exact `flatMap` plus pipeable `as` target ([source](https://github.com/pingdotgg/t3code/blob/b41e89eba9cd232cc3257b400fc30972a9b53438/apps/server/src/provider/Layers/CursorProvider.ts#L1144-L1146))
- Distilled v4 contains an exact `flatMap` plus pipeable `as` target ([source](https://github.com/alchemy-run/distilled/blob/d9fa6d104839dce6606f069205165c10b0cdd737/packages/workos/test/UserlandUserInvitesControllerCreate.test.ts#L20-L25))

Disable the Effect bucket for non-Effect projects:

```js
import theThracian from '@thethracian/oxlint-config';

export default theThracian({
  effect: false,
});
```

## Strict Effect Mode

Strict mode adds project-boundary checks. It is intentionally opinionated and is best for Effect services with clear layers.

```js
import theThracian from '@thethracian/oxlint-config';

export default theThracian({
  effect: {
    strict: true,
  },
});
```

Override the default project layout when your repository uses different paths:

```js
import theThracian from '@thethracian/oxlint-config';

export default theThracian({
  effect: {
    strict: {
      adapterLayers: ['src/platform/**'],
      compositionRoots: ['workers/main.ts'],
      configLayers: ['settings/**'],
      domain: ['packages/domain/**'],
      entrypoints: ['workers/main.ts'],
      integrationTests: ['**/*.integration.test.ts'],
      unitTests: ['**/*.test.ts'],
    },
  },
});
```

## What It Enforces

| Area                   | Policy                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Size and shape         | 150-character lines, 500-line files, 75-line functions, max nesting depth 3, max 5 parameters, cyclomatic complexity 10          |
| TypeScript safety      | no `any` escape hatches, no unsafe calls/member access, explicit function return types, strict equality                          |
| Async safety           | no floating promises in type-aware mode, no misused promises, no unhandled Effect values                                         |
| Debug and dynamic code | no `console`, `debugger`, `eval`, `new Function`, script URLs, warning comments, or commented-out code                           |
| Immutability           | `prefer-const` and no parameter reassignment, including property mutation                                                        |
| Naming                 | PascalCase types, camelCase identifiers, boolean prefixes, private underscores, and consistent acronym casing                    |
| Effect                 | generator style, typed errors, Schema validation, resource safety, bounded concurrency, test determinism, and project boundaries |

## Registry Links

- npm: <https://www.npmjs.com/package/@thethracian/oxlint-config>
- Socket package analysis: <https://socket.dev/npm/package/%40thethracian/oxlint-config>
- Source: <https://github.com/stefan-vatov/code-quality/tree/main/ts>
- Issues: <https://github.com/stefan-vatov/code-quality/issues>

## License

MIT. See [LICENSE](LICENSE).
