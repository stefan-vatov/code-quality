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

The syntax-only base config selects 165 reviewed rules: 146 syntax-only upstream Oxlint rules and 19
package-local TypeScript safety rules. Oxlint normally supplies
implicit `correctness` warnings; the config performs one category-level reset with
`correctness: 'allow'` and then assigns `error` to the approved rules explicitly. This is not a
warning downgrade and is not a collection of rule-level disables: unapproved rules simply do not
enter the effective allowlist.

The audit physically removed generic homegrown rules whose style or naming opinions did not provide a
dependable correctness signal. It also removed unreliable Effect heuristics and semantically
unsound module-scope rules; those rules are not merely hidden by configuration. The retained
package-local Effect rules form one opt-in preset, described below.

The base structural limits are deliberately configurable values with clear review value:

| Rule                     |                                           Limit |
| ------------------------ | ----------------------------------------------: |
| `complexity`             |                                              10 |
| `max-lines`              | 5,000 lines, excluding blank lines and comments |
| `max-depth`              |                                        5 levels |
| `max-lines-per-function` |   150 lines, excluding blank lines and comments |
| `max-nested-callbacks`   |                                        6 levels |
| `max-params`             |                                    7 parameters |

Line width belongs to the formatter, not the lint policy. Files are capped at 5,000 lines, excluding blank lines and comments. There is no
import-count rule. General naming preferences are absent except for the imported symbol-name rule.
The base profile also intentionally omits global `console`, null,
ternary, magic-number, documentation, and absolute `any`/assertion bans: those rules produce
mechanical churn or reject legitimate framework, generated-code, and interop boundaries without a
reliable defect signal.

## Suppressions, focused tests, and classic bugs

The preset treats escape hatches and debug leftovers as errors in every configuration:

| Rule or option                                    | Policy                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `thethracian/require-disable-justification`       | Requires ` -- <reason>` (four or more words) on every disable directive and rejects boilerplate. |
| `unicorn/no-abusive-eslint-disable`               | Rejects `oxlint-disable`/`eslint-disable` comments that name no rules, which silence every rule. |
| `options.reportUnusedDisableDirectives`           | `error`: an `oxlint-disable` or `eslint-disable` comment that suppresses nothing fails the lint. |
| `typescript/ban-ts-comment`                       | Rejects `@ts-ignore` and `@ts-nocheck`; `@ts-expect-error` needs a description.                  |
| `jest/no-focused-tests`                           | Rejects `.only` and `f`-prefixed tests in Vitest, Jest, Bun, and `node:test` suites.             |
| `jest/no-disabled-tests`                          | Rejects `.skip`, `x`-prefixed, and bodiless tests. Conditional and planned tests stay allowed.   |
| `no-warning-comments` with `terms: ['@nocommit']` | Rejects the `@nocommit` marker. `TODO` and `FIXME` stay allowed.                                 |

It also enables classic bug catchers whose every hit is a defect:

- `no-fallthrough`, `no-case-declarations`: switch cases that run into each other or leak declarations.
- `no-self-compare`, `oxc/bad-bitwise-operator`: `x === x` and `|`/`&` written where `||`/`&&` was meant.
- `array-callback-return`: `map`, `filter`, `find`, and similar callbacks that forget to return.
- `promise/no-return-in-finally`: a value returned from `.finally()` that is silently discarded.
- `no-useless-assignment`: values that are overwritten before anyone reads them.
- `no-var`: function-scoped bindings; pairs with `prefer-const`.
- `typescript/no-unsafe-function-type`, `typescript/no-empty-object-type`: the `Function` and `{}`
  types that accept almost anything.
- `oxc/no-accumulating-spread`: spreading the accumulator in `reduce`, which is quadratic.
- `typescript/no-non-null-asserted-nullish-coalescing`: `value.field! ?? fallback`, where the `!`
  contradicts the fallback. Oxlint checks member and call operands; bare identifiers are not checked.

### Skipped tests

A committed skip passes CI while the behavior it covered goes untested. Replace unconditional skips
with a form that states why the test does not run:

| Instead of                 | Use                                                        |
| -------------------------- | ---------------------------------------------------------- |
| `it.skip(...)`, `xit(...)` | `it.skipIf(condition)(...)` or `it.runIf(condition)(...)`  |
| `test('planned behavior')` | `test.todo('planned behavior')`                            |
| Skip decided while running | `it('...', (context) => { if (...) context.skip(); ... })` |

Generated files often start with a blanket `/* eslint-disable */` header. Keep them out of the lint
with `ignorePatterns` instead of relying on that header, because the preset rejects blanket disables.

Rewrite skips rather than suppressing the rule. Older Oxlint releases (including 1.66) do not apply
`jest/no-disabled-tests` to tests imported from `@effect/vitest`, so a disable comment that is needed
on a newer Oxlint becomes an unused directive, which is an error, on an older one. With
`effect: true`, `thethracian/effect-no-skipped-effect-tests` also reports Effect test skips,
including `it.effect.skip`.

### Migrating to 0.11.0 and 0.12.0

These rules are breaking for existing code. To adopt them gradually, override individual rules in
your own config and remove the overrides as you fix each one:

```js
import theThracian from '@thethracian/oxlint-config';

const config = theThracian({ typeAware: true });

export default {
  ...config,
  options: { ...config.options, reportUnusedDisableDirectives: 'allow' },
  rules: { ...config.rules, 'no-useless-assignment': 'allow' },
};
```

## Additional TypeScript safety rules

The package-local plugin enables these 19 rules as errors in every configuration.

| Rule                                             | Policy                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `thethracian/no-array-filter-map`                | Rejects adjacent eager `filter`/`map` passes on known arrays; use one pass or iterator helpers.     |
| `thethracian/no-chained-type-assertions`         | Rejects nested type assertions that fabricate evidence; `as const` chains remain valid.             |
| `thethracian/no-conditional-empty-object-spread` | Rejects conditional object spreads whose empty branch silently omits fields.                        |
| `thethracian/no-known-value-widening`            | Rejects known values widened into `unknown`, `object`, anonymous objects, or open dictionaries.     |
| `thethracian/no-module-mocking`                  | Rejects Vitest and Jest module-mocking calls.                                                       |
| `thethracian/no-object-parameters`               | Rejects `object` and aliases resolving to it on function inputs.                                    |
| `thethracian/no-reduce-accumulator-copy`         | Rejects copying a growing `reduce` accumulator with `Object.assign`, `Array.from`, or `concat`.     |
| `thethracian/no-reflect-apply`                   | Requires typed calls instead of global `Reflect.apply`.                                             |
| `thethracian/no-reflect-get`                     | Requires typed property access or boundary parsing instead of global `Reflect.get`.                 |
| `thethracian/no-runtime-typeof`                  | Rejects ad hoc `typeof` narrowing; explicit type guards and existence probes remain valid.          |
| `thethracian/no-shape-in-symbol-names`           | Rejects locally owned symbol names containing `shape`; static member names remain valid.            |
| `thethracian/no-tautological-assertions`         | Rejects assertions on constants or a value compared with itself, such as `expect(true).toBe(true)`. |
| `thethracian/no-try-catch-throw`                 | Rejects `try` statements, including `try/finally`, and `throw` statements.                          |
| `thethracian/no-unknown-parameters`              | Rejects `unknown` function inputs except supported predicate and `cause` conventions.               |
| `thethracian/no-unknown-returns`                 | Rejects explicit `unknown`, `Promise<unknown>`, and `PromiseLike<unknown>` return contracts.        |
| `thethracian/no-unknown-type-aliases`            | Rejects aliases that resolve to `unknown`.                                                          |
| `thethracian/no-unsafe-dictionary-type`          | Rejects dictionary value contracts based on `unknown`, `any`, `object`, or `{}`.                    |
| `thethracian/no-widen-then-assert`               | Rejects immutable flows that widen evidence and later assert it back to a narrow type.              |
| `thethracian/require-disable-justification`      | Requires `-- <reason>` of at least four words on every disable directive; rejects boilerplate.      |

These rules have no automatic migration behavior and do not replace the native Oxlint allowlist.

`thethracian/no-try-catch-throw` is a breaking change to the base preset, including with
`effect: false`. Use Effect's [`Result`](https://effect.website/docs/v4/data-types/result)
([`Either`](https://effect.website/docs/v3/data-types/either) in Effect 3) when callers need the
failure value. Use [`Option`](https://effect.website/docs/v4/data-types/option) when a value may be
absent. At boundaries that call throwing APIs, use `Effect.try` or `Effect.tryPromise` to turn
exceptions into typed failures. Use `Effect.ensuring` for cleanup that previously ran in `finally`.

The TypeScript/JavaScript `no-comments` rule has been deleted. Comments and documentation
comments are allowed by this package; Rust and Elixir retain their separate comment policies.

The former safety-comment assertion rule and Effect suppression-comment requirement are removed.
Assertions remain subject to the type-safety rules; they no longer require comments.

The preset configures `no-runtime-typeof` with `allowInTypeGuards: true`: predicate and assertion
functions can establish primitive contracts without the boxed `instanceof` checks rejected by
`unicorn/no-instanceof-builtins`. Other runtime `typeof` narrowing remains forbidden. Calling a
type guard does not erase the caller's type, so `no-known-value-widening` checks explicit storage,
return, and assertion types, not predicate arguments.

`typescript/no-unnecessary-type-parameters` is intentionally omitted. Its recommendation to
replace generic parameters with `unknown`, `object`, or broad dictionaries conflicts with the
boundary rules above. Generic consumers may keep their type parameters; unchecked operations
remain errors.

The mocking rule follows named and namespace imports, including `vitest.vi.mock(...)` and
`globals.jest.mock(...)`, without treating shadowed local objects as test frameworks. The symbol
naming rule checks local import bindings, not upstream export names: importing `ZodRawShape` as
`SchemaFields` is allowed.

## Install

```sh
pnpm add -D @thethracian/oxlint-config oxlint@^1.66.0
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

Type-aware mode keeps the 19 package-local rules and adds all 31 approved semantic rules for 196
selected errors in total (177 native upstream errors plus the 19 package-local rules). They include
checks for floating and misused promises, awaiting non-thenables, unsafe calls, member access,
assignments, arguments, and returns, plus promise rejection and switch exhaustiveness. None of
those 31 rules is emitted by the syntax-only config, where Oxlint's semantic backend would not run
it. Type-aware linting is slower because Oxlint loads project type information.

Explicit `any` annotations, non-null assertions, and boundary type assertions remain available at
validated, generated, framework, and interop boundaries. The type-aware unsafe-operation rules
still reject unchecked use of those values.

## Effect safety and canonical-pattern rules (opt in)

Effect-specific checks are disabled by default. Pass `effect: true` when the project uses Effect and wants
all 36 retained Effect rules plus the additional
`thethracian/no-service-constructor-imports` rule. These package-local rules are all reported as
errors. They combine safety checks with deliberate canonical-pattern guardrails for consistent
Effect code, including AI-generated code:

```js
export default theThracian({
  effect: true,
});
```

The unchanged 18-rule safety bucket is:

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
concurrency. `effect-no-silent-error-swallowing` checks the AST of each recovery call and covers
both Effect 3 and Effect 4 names: it reports `Effect.catch`, `catchAll`, `catchCause`, and
`catchAllCause` handlers that only return `Effect.void` or `Effect.succeed(undefined)`, plus every
`Effect.ignore(...)` call. Targeted `catchTag`/`catchTags` recovery and Effect 3's
`Effect.catch("_tag", { ... })` discriminator form are allowed. The additional service-constructor rule rejects named `make<Capability>Service` imports from
relative project modules outside focused test files. They do not include preference-only migration
advice.

The other six retained Effect rules are also enabled by `effect: true`:

```text
effect-no-known-fake-api
effect-require-service-self-match
effect-no-focused-effect-tests
effect-no-skipped-effect-tests
effect-no-runSync-in-server-request-handlers
effect-no-run-inside-effect
```

`effect-no-run-inside-effect` rejects `Effect.runSync`, `runPromise`, `runPromiseExit`, `runFork`,
and related runners called inside an `Effect.gen` or `Effect.fn` generator, a callback passed to an
Effect API, an object-literal handler passed to an Effect API, or an immediately invoked function
there. Those calls start a separate root fiber that loses services, interruption, and typed
failures; compose with `yield*`, `Effect.exit`, or `Effect.forkDaemon`/`Effect.forkScoped` instead.
Callbacks handed to non-Effect APIs or constructors (a storage transaction, a `ReadableStream`
source, an event listener), named local helpers, and `Runtime.run*` on a captured runtime are treated
as bridges and stay allowed.

The public option is `effect?: boolean`. Omit it or pass `false` to disable Effect rules and the
service-constructor rule. Any nonboolean value, including the former strict options object, throws
`TypeError`. Replace old `effect: { strict: ... }` configurations with `effect: true` or `false`;
rule selections and path groups are no longer supported. The public `EffectStrictRuleName`,
`TheThracianEffectOptions`, and `TheThracianEffectStrictOptions` types are removed.

Twelve canonical-pattern rules are also enabled, with no separate switches or warning tier:

```text
effect-no-catchAll-with-mapError
effect-prefer-effect-void
effect-prefer-asVoid
effect-prefer-flatMap-over-map-flatten
effect-prefer-succeed-for-static-layers
effect-prefer-schema-tagged-struct
effect-prefer-single-schema-literal-union
effect-schema-require-parseJson-for-json-strings
effect-schema-no-cast-after-decode
effect-no-error-channel-widening-to-unknown
effect-require-service-class-pattern
effect-require-deterministic-service-keys
```

These are intentional conventions, not claims that every rejected alternative is a runtime bug.
The checks use AST structure and Effect import identity rather than nearby text. Pure result
discarding excludes side-effecting callbacks; literal-union simplification excludes annotated
alternatives. Service keys must equal the class name or end with `/ClassName`.
`effect-no-catchAll-with-mapError` treats Effect 4's `Effect.catch` like `catchAll` when the handler
only re-fails.
Schema cast checks cover direct assertions of decoder calls, not arbitrary downstream dataflow;
the error-channel rule rejects explicit `unknown` error arguments, not every inferred widening.
Rules report errors without semantic autofixes.

The other deleted rules remain absent, including path-based architecture rules and unreliable
resource heuristics. Restoring the canonical rules does not reintroduce strict selections or path
groups. Architecture boundaries belong in consuming repositories with concrete path or import
contracts, not in this shared preset. The package does not infer module roles from unrelated imports
or name suffixes, or require consumers to adopt a prescribed folder structure.

With `typeAware: true`, the base preset enables 196 errors (177 native plus 19 package-local), or
233 with `effect: true` (196 plus 36 Effect rules and the service-constructor rule). Without
type-aware mode, the totals are 165 and 202 respectively. Internal name lists retain
35 default rules and one server-handler rule for compatibility; they do not expose strict opt-ins.

## Semantic codemods (explicit only)

Semantic codemod implementations remain available for reviewed migrations. They can change
function forms, imports, exports, or control flow, so run them as a deliberate command and validate
the resulting behavior.

The codemods run on `jscodeshift`. The package does not declare it as a dependency or peer, so
lint-only consumers never install its Babel toolchain. Install it before using the codemods:

```sh
pnpm add -D jscodeshift@^17.4.0
pnpm exec thx-codemod-fix --dry-run src
```

Without `jscodeshift`, `thx-codemod-fix` exits with status 1 and prints the install command. The
`@thethracian/oxlint-config/codemod-fix` import requires it too:

```ts
import { codemodFix } from '@thethracian/oxlint-config/codemod-fix';

codemodFix({
  paths: ['src', 'scripts'],
});
```

Do not add this call to `lint`, `lint:fix`, `lint-staged`, or a pre-commit hook.

## What it enforces

| Area                 | Policy                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shape                | 5,000-line files, 150-line functions, depth 5, six nested callbacks, seven parameters, complexity 10                                                                                           |
| Upstream safety      | `import/no-duplicates`, `no-debugger`, empty-block checks, `no-eval`, `no-new-func`, `no-script-url`, strict equality, `oxc/only-used-in-recursion`, `prefer-const`, caught-error preservation |
| TypeScript safety    | 19 package-local errors covering exception syntax, evidence-preserving assertions, unknown/object boundaries, runtime reflection, mocking, and type-shape hygiene                              |
| Type-aware safety    | Unsafe operations, floating/misused promises, promise rejection errors, exhaustive switches                                                                                                    |
| Effect               | 36 Effect errors plus the service-constructor rule with `effect: true`                                                                                                                         |
| Deliberate omissions | No global `console`, null, ternary, magic-number, general naming (except the imported symbol-name rule), import-count, documentation, or absolute assertion/`any` bans                         |

## Registry links

- npm: <https://www.npmjs.com/package/@thethracian/oxlint-config>
- Source: <https://github.com/stefan-vatov/code-quality/tree/main/ts>
- Issues: <https://github.com/stefan-vatov/code-quality/issues>

## License

MIT. See [LICENSE](LICENSE).

### Third-party notice

Portions of the generic TypeScript safety rules (the `no-reflect-*`, `no-unknown-*`,
`no-known-value-widening`, `no-widen-then-assert`, `no-array-filter-map`,
`no-reduce-accumulator-copy`, and related `thethracian/` rules) are adapted
from [anti-slop](https://github.com/dmmulroy/anti-slop), Copyright (c) 2026 Dillon Mulroy, used
under the MIT License.

The suppression, focused-test, `@nocommit`, and classic bug-catcher selections added in 0.11.0 were
informed by [@nkzw/oxlint-config](https://github.com/nkzw-tech/oxlint-config), Copyright (c) 2026
Nakazawa Tech, MIT License.
