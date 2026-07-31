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
- Effect-aware out of the box: 83 always-on Effect rules target lazy values, generator style, Promise boundaries, typed errors, Schema boundaries, resources, tests, and common hallucinated APIs.
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
