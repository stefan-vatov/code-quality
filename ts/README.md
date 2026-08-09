# @thethracian/oxlint-config

<p align="center">
  <a href="https://www.npmjs.com/package/@thethracian/oxlint-config"><img alt="npm version" src="https://img.shields.io/npm/v/@thethracian/oxlint-config?style=flat-square"></a>
  <a href="https://www.npmjs.com/package/@thethracian/oxlint-config"><img alt="npm downloads" src="https://img.shields.io/npm/dw/@thethracian/oxlint-config?style=flat-square"></a>
  <a href="https://github.com/stefan-vatov/code-quality/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/stefan-vatov/code-quality/ci.yml?branch=main&style=flat-square"></a>
  <a href="https://github.com/stefan-vatov/code-quality/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
</p>

The Thracian Oxlint config is a strict, high-signal TypeScript profile for teams that want
generated code reviewed like production code. The base policy uses an explicit allowlist of
approved upstream Oxlint rules. Every active rule is an `error`; there is no warning tier and no
rule-level `off` entry.

```js
// oxlint.config.mjs
import theThracian from '@thethracian/oxlint-config';

export default theThracian({ typeAware: true });
```

## Base policy

The base config selects only reviewed upstream Oxlint rules. Oxlint normally supplies implicit
`correctness` warnings; the config performs one category-level reset with `correctness: 'allow'`
and then assigns `error` to the approved rules explicitly. This is not a warning downgrade and is
not a collection of rule-level disables: unapproved rules simply do not enter the effective
allowlist.

The audit physically removed generic homegrown rules whose style or naming opinions did not provide a
dependable correctness signal. It also removed the flagged Effect preference rules and semantically
unsound module-scope rules; those rules are not merely hidden by configuration. The retained
package-local Effect safety and architecture rules are a separate, intentionally opt-in policy and
remain available below.

The base structural limits are deliberately configurable values with clear review value:

| Rule                     |                                         Limit |
| ------------------------ | --------------------------------------------: |
| `complexity`             |                                            20 |
| `max-depth`              |                                      5 levels |
| `max-lines-per-function` | 150 lines, excluding blank lines and comments |
| `max-nested-callbacks`   |                                      6 levels |
| `max-params`             |                                  7 parameters |

Line width belongs to the formatter, not the lint policy. There is no maximum file-length or
import-count rule. The base profile also intentionally omits global `console`, naming, null,
ternary, magic-number, documentation, and absolute `any`/assertion bans: those rules produce
mechanical churn or reject legitimate framework, generated-code, and interop boundaries without a
reliable defect signal.

## Install

```sh
pnpm add -D @thethracian/oxlint-config oxlint@^1.63.0
```

Run Oxlint directly or add scripts to the consumer project:

```json
{
  "scripts": {
    "lint": "oxlint src",
    "lint:fix": "oxlint src --fix",
    "lint:type-aware": "oxlint src --type-aware --type-check",
    "lint:fix:type-aware": "oxlint src --type-aware --type-check --fix"
  }
}
```

Oxlint owns local, semantics-preserving fixes. The package's semantic codemod command is a
different tool and is never part of `oxlint --fix`, `lint-staged`, or any automatic lint hook.

## Type-aware mode

Set `typeAware: true` when the project has the TypeScript project information needed for semantic
checks:

```js
export default theThracian({
  typeAware: true,
});
```

Type-aware mode enables upstream checks for floating and misused promises, unsafe calls, member
access, assignments, arguments, and returns, plus promise rejection and switch-exhaustiveness
checks. It is slower than syntax-only linting because Oxlint loads project type information.

Explicit `any` annotations, non-null assertions, and boundary type assertions remain available at
validated, generated, framework, and interop boundaries. The type-aware unsafe-operation rules
still reject unchecked use of those values.

## Effect safety rules (opt in)

Effect rules are disabled by default. Pass `effect: true` when the project uses Effect and wants
the 18 retained high-confidence safety rules. These are package-local rules, all reported as
errors, and focus on observable hazards rather than style preferences:

```js
export default theThracian({
  effect: true,
});
```

The safety bucket is exactly:

```text
effect-no-floating-effect
effect-require-yield-star
effect-require-return-yield-star
effect-no-floating-fiber
effect-require-suspend-for-recursion
effect-no-silent-error-swallowing
effect-require-typed-error-in-trypromise
effect-require-error-cause-preserved
effect-no-runfork-without-observer
effect-require-acquire-release
effect-require-scoped-for-acquireRelease
effect-require-scoped-for-resources
effect-no-fork-daemon-without-cleanup
effect-require-restore-for-fork-in-uninterruptible
effect-require-bounded-concurrency
effect-require-bounded-flatMap-concurrency
effect-no-unbounded-queue
effect-no-unbounded-stream-buffer
```

They cover floating Effects and fibers, missing generator delegation, eager recursion, silent
failures, lost error causes, unscoped resources, unobserved forks, and unbounded queues or
concurrency. They do not include preference-only migration advice.

## Strict Effect architecture (explicit opt in)

There are 60 retained strict Effect architecture rules. None is enabled by `effect: true` alone.
Select each rule by name and provide every path group that it inspects; selected rules remain
errors.

```js
export default theThracian({
  effect: {
    strict: {
      adapterLayers: ['src/platform/**'],
      entrypoints: ['src/main.ts'],
      rules: ['effect-no-global-fetch', 'effect-require-platform-runmain-at-entrypoints'],
    },
  },
});
```

The API rejects `effect.strict: true`, unknown rule names, missing required path groups, and
malformed path arrays. Use `strict: false` or `strict: { enabled: false, rules: [...] }` for an
explicit disable. The path groups are project declarations, not guessed `src/**` defaults.

The plugin also retains 19 specialized migration, version, error-model, schema, and test analyzers
for explicit rule configuration. They are never in the base preset or the 18-rule safety bucket,
and they never become warnings. Together with the 18 safety rules and 60 strict architecture rules,
the retained plugin surface is 97 rules.

## Semantic codemods (explicit only)

Semantic codemod implementations remain available for reviewed migrations. They can change
function forms, imports, exports, or control flow, so run them as a deliberate command and validate
the resulting behavior:

```ts
import { codemodFix } from '@thethracian/oxlint-config/codemod-fix';

codemodFix({
  paths: ['src', 'scripts'],
});
```

Do not add this call to `lint`, `lint:fix`, `lint-staged`, or a pre-commit hook.

## What it enforces

| Area                 | Policy                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Shape                | 150-line functions, depth 5, six nested callbacks, seven parameters, complexity 20                                                       |
| Upstream safety      | `no-debugger`, empty-block checks, `no-eval`, `no-new-func`, `no-script-url`, strict equality, `prefer-const`, caught-error preservation |
| Type-aware safety    | Unsafe operations, floating/misused promises, promise rejection errors, exhaustive switches                                              |
| Effect               | 18 safety errors with `effect: true`; 60 architecture errors only when explicitly selected with paths                                    |
| Deliberate omissions | No global `console`, null, ternary, magic-number, naming, file-size, import-count, documentation, or absolute assertion/`any` bans       |

## Registry links

- npm: <https://www.npmjs.com/package/@thethracian/oxlint-config>
- Source: <https://github.com/stefan-vatov/code-quality/tree/main/ts>
- Issues: <https://github.com/stefan-vatov/code-quality/issues>

## License

MIT. See [LICENSE](LICENSE).
