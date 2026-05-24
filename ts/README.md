# @thethracian/oxlint-config

Importable Oxlint config for TypeScript projects.

The config errors on lines over 150 characters, files over 500 lines, functions over 75 lines, nesting deeper than 3 levels, callback nesting deeper than 4 levels (max-nested-callbacks), more than 5 parameters, cyclomatic complexity over 10, requires strict equality (eqeqeq), denies eval and dynamic code execution (no-eval, no-implied-eval when type-aware), denies debug artifacts (no-console, no-debugger), bans silent catch blocks (no-empty), bans commented-out code (custom thethracian/no-commented-out-code rule), bans inline comments and warning comments (no-inline-comments, no-warning-comments), bans `any` and untyped escape hatches (no-explicit-any, no-unsafe-call, no-unsafe-member-access, plus no-unsafe-assignment/return/argument when type-aware), denies unhandled promises (no-floating-promises, no-misused-promises when type-aware), and enforces immutability with prefer-const and no-param-reassign (including property mutations).

The package uses Oxlint's native complexity rule and ships the Oxlint type-aware runner needed by
the `typeAware` profile.

```sh
pnpm add -D @thethracian/oxlint-config oxlint@^1.63.0
```

```ts
import theThracian from '@thethracian/oxlint-config';

export default theThracian();
```

Enable type-aware Oxlint execution and the matching type-aware rules from the shared config:

```ts
import theThracian from '@thethracian/oxlint-config';

export default theThracian({
  typeAware: true,
});
```

The 81-rule always-on default Effect bucket is enabled by default for this config. These rules
target lazy Effect values, generator style, Promise boundaries, typed errors, resource safety,
Schema boundaries, test determinism, stale APIs, platform escape hatches, unsafe Effect type
assertions, service self-type drift, and common AI-generated Effect hallucinations.

Non-Effect projects can disable that bucket explicitly:

```ts
import theThracian from '@thethracian/oxlint-config';

export default theThracian({
  effect: false,
});
```

Effect projects that want strict project-boundary enforcement can opt in to the 60-rule strict
bucket:

```ts
import theThracian from '@thethracian/oxlint-config';

export default theThracian({
  effect: {
    strict: true,
  },
});
```

Strict mode uses conventional project globs for entrypoints, composition roots, config layers,
domain modules, adapters, and test types. Override them when a project uses a different layout:

```ts
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
