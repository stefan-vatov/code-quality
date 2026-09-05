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

The syntax-only base config selects 143 reviewed rules: 129 syntax-only upstream Oxlint rules and 14
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

## Additional TypeScript safety rules

The package-local plugin enables these 14 rules as errors in every configuration. They use Oxlint's
ESTree and lexical-scope APIs, resolve same-file aliases, and deliberately stop at file boundaries:

| Rule                                             | Policy                                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `thethracian/no-chained-type-assertions`         | Rejects nested type assertions that fabricate evidence; `as const` chains remain valid.         |
| `thethracian/no-conditional-empty-object-spread` | Rejects conditional object spreads whose empty branch silently omits fields.                    |
| `thethracian/no-known-value-widening`            | Rejects known values widened into `unknown`, `object`, anonymous objects, or open dictionaries. |
| `thethracian/no-module-mocking`                  | Rejects Vitest and Jest module-mocking calls.                                                   |
| `thethracian/no-object-parameters`               | Rejects `object` and aliases resolving to it on function inputs.                                |
| `thethracian/no-reflect-apply`                   | Requires typed calls instead of global `Reflect.apply`.                                         |
| `thethracian/no-reflect-get`                     | Requires typed property access or boundary parsing instead of global `Reflect.get`.             |
| `thethracian/no-runtime-typeof`                  | Rejects ad hoc `typeof` narrowing; explicit type guards and existence probes remain valid.      |
| `thethracian/no-shape-in-symbol-names`           | Rejects locally owned symbol names containing `shape`; static member names remain valid.        |
| `thethracian/no-unknown-parameters`              | Rejects `unknown` function inputs except supported predicate and `cause` conventions.           |
| `thethracian/no-unknown-returns`                 | Rejects explicit `unknown`, `Promise<unknown>`, and `PromiseLike<unknown>` return contracts.    |
| `thethracian/no-unknown-type-aliases`            | Rejects aliases that resolve to `unknown`.                                                      |
| `thethracian/no-unsafe-dictionary-type`          | Rejects dictionary value contracts based on `unknown`, `any`, `object`, or `{}`.                |
| `thethracian/no-widen-then-assert`               | Rejects immutable flows that widen evidence and later assert it back to a narrow type.          |

These rules have no automatic migration behavior and do not replace the native Oxlint allowlist.

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

Type-aware mode keeps the 14 package-local rules and adds all 31 approved semantic rules for 174
selected errors in total (160 native upstream errors plus the 14 package-local rules). They include
checks for floating and misused promises, awaiting non-thenables, unsafe calls, member access,
assignments, arguments, and returns, plus promise rejection and switch exhaustiveness. None of
those 31 rules is emitted by the syntax-only config, where Oxlint's semantic backend would not run
it. Type-aware linting is slower because Oxlint loads project type information.

Explicit `any` annotations, non-null assertions, and boundary type assertions remain available at
validated, generated, framework, and interop boundaries. The type-aware unsafe-operation rules
still reject unchecked use of those values.

## Effect safety and canonical-pattern rules (opt in)

Effect rules are disabled by default. Pass `effect: true` when the project uses Effect and wants
all 35 retained Effect rules plus the additional
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
concurrency. The additional service-constructor rule rejects named `make<Capability>Service` imports from
relative project modules outside focused test files. They do not include preference-only migration
advice.

The other five retained Effect rules are also enabled by `effect: true`:

```text
effect-no-known-fake-api
effect-require-service-self-match
effect-no-focused-effect-tests
effect-no-skipped-effect-tests
effect-no-runSync-in-server-request-handlers
```

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
Schema cast checks cover direct assertions of decoder calls, not arbitrary downstream dataflow;
the error-channel rule rejects explicit `unknown` error arguments, not every inferred widening.
Rules report errors without semantic autofixes.

The other deleted rules remain absent, including path-based architecture rules and unreliable
resource heuristics. Restoring the canonical rules does not reintroduce strict selections or path
groups. Architecture boundaries belong in consuming repositories with concrete path or import
contracts, not in this shared preset. The package does not infer module roles from unrelated imports
or name suffixes, or require consumers to adopt a prescribed folder structure.

With `typeAware: true`, the base preset enables 174 errors (160 native plus 14 generic), or
210 with `effect: true` (174 plus 35 Effect rules and the service-constructor rule). Without
type-aware mode, the totals are 143 and 179 respectively. Internal name lists retain
34 default rules and one server-handler rule for compatibility; they do not expose strict opt-ins.

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

| Area                 | Policy                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shape                | 5,000-line files, 150-line functions, depth 5, six nested callbacks, seven parameters, complexity 10                                                                                           |
| Upstream safety      | `import/no-duplicates`, `no-debugger`, empty-block checks, `no-eval`, `no-new-func`, `no-script-url`, strict equality, `oxc/only-used-in-recursion`, `prefer-const`, caught-error preservation |
| TypeScript safety    | 14 package-local errors for evidence-preserving assertions, unknown/object boundaries, runtime reflection, mocking, and type-shape hygiene                                                     |
| Type-aware safety    | Unsafe operations, floating/misused promises, promise rejection errors, exhaustive switches                                                                                                    |
| Effect               | 35 Effect errors plus the service-constructor rule with `effect: true`                                                                                                                         |
| Deliberate omissions | No global `console`, null, ternary, magic-number, general naming (except the imported symbol-name rule), import-count, documentation, or absolute assertion/`any` bans                         |

## Registry links

- npm: <https://www.npmjs.com/package/@thethracian/oxlint-config>
- Source: <https://github.com/stefan-vatov/code-quality/tree/main/ts>
- Issues: <https://github.com/stefan-vatov/code-quality/issues>

## License

MIT. See [LICENSE](LICENSE).
