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
- Effect-aware out of the box: 81 always-on Effect rules target lazy values, generator style, Promise boundaries, typed errors, Schema boundaries, resources, tests, and common hallucinated APIs.
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

Add fix scripts when you want the packaged codemods and native Oxlint fixes to run together:

```json
{
  "scripts": {
    "lint": "oxlint .",
    "lint:fix": "thx-codemod-fix src && oxlint . --fix && thx-codemod-fix src"
  }
}
```

`thx-codemod-fix` is intentionally separate from `oxlint --fix` because Oxlint owns native rule fixes and the package CLI owns larger AST codemods. Running it before and after Oxlint is safe because the codemods are idempotent. The CLI defaults to `src`, but you can pass any files or directories your project wants fixed.

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
- string errors and untagged error channels
- unsafe Promise, throw, runtime, and sync boundaries
- Schema decode misuse at external data boundaries
- resource, fiber, stream, concurrency, and test determinism mistakes
- deprecated or invented Effect APIs

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
