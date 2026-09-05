# Agent Guide

## Purpose

This repository is the source of truth for The Thracian code-quality configuration packages. It publishes each language through its native package ecosystem so configs can be versioned, consumed, and updated consistently across other repositories.

The repo is intentionally small and practical: keep each language package self-contained, avoid repo sprawl, and make every exported config usable by downstream projects without requiring consumers to understand this monorepo.

## Architecture

This is a pnpm + Nx workspace. Each package lives at the repository root in a single folder:

- `ts/`: `@thethracian/oxlint-config`
  - Importable first-party Oxlint config for TypeScript projects.
  - Consumers import this package directly from their Oxlint config.
- `rust/`: `cargo-thx-lint`
  - Cargo subcommand published as a crates.io crate.
  - Consumers install it with `cargo install cargo-thx-lint` and run `cargo thx-lint init --write`.
  - The binary embeds rustfmt, Clippy, Cargo lint table, and Dylint check assets.
- `elixir/`: `the_thracian_credo`
  - Hex package published as a Credo plugin and Mix installer.
  - Consumers add it to `mix.exs`, run `mix thx_lint.install --yes`, and then run `mix credo --strict`.
  - Custom checks are shipped as dependency modules, not copied into consumer repos.

The root workspace owns tooling only: Nx project orchestration, Oxlint/Oxfmt for this repo, Vitest,
Knip, and hooks.

## Quality Gates

Exported configs should be strict by default. The shared policy is binary: every active rule is an
error/deny/forbid. There is no warning tier. For TypeScript, the base preset is an explicit
allowlist of reviewed upstream Oxlint rules; unapproved rules are omitted rather than represented
by rule-level `off` entries.

Cross-language correctness invariants:

- No accidental debug-only artifacts in production code: ban `debugger`, `dbg!`, `todo!`,
  `IO.inspect`, `IEx.pry`, and equivalent language-specific traps. Console and print policies remain
  language-specific because they can be legitimate application output.
- No silent catch: empty catch/rescue blocks are forbidden; all exceptions must be routed to a logger, error reporter, or re-raised.
- Rust and Elixir reject lexical comments, including documentation comments and comment-based
  suppressions; interpreter shebangs and Elixir documentation attributes remain allowed.
  TypeScript/JavaScript no longer ship a comment-ban rule. Keep complex explanations in external
  documentation and use native types instead of JSDoc annotations.
- No unhandled async work: promises/futures/results must be awaited, returned, or explicitly handled.
- Exhaustiveness required: unions/enums must be exhaustively handled in switch/match statements.
- No unchecked dynamic escape hatches: ban constructs that bypass the type system (unsafe any operations, wildcard enum matches, underspecified function specs).
- No unchecked mutation: enforce immutability where the language has a reliable signal — prefer-const in TypeScript, unused_mut + pedantic Clippy in Rust, VariableRebinding in Elixir.

TypeScript/Oxlint high-signal policy:

- The base preset is an explicit allowlist of approved upstream Oxlint rules, all as `error`.
  Oxlint's implicit correctness warnings are neutralized once with a category-level
  `correctness: 'allow'` reset before the allowlist is applied. There are no rule-level `off`
  entries and no warning severity.
- Size limits are complexity 10, nesting depth 5, file length 5,000 lines (excluding blank lines and comments), function length 150 lines, nested callbacks 6, and parameters 7. Line width is formatter-owned and has no lint cap.
- Files are capped at 5,000 lines, excluding blank lines and comments. There is no import-count rule. Split oversized files along meaningful module boundaries rather than creating mechanical shards.
- General naming preferences (except the imported symbol-name rule), null bans, ternary bans, magic-number bans, and file/function documentation requirements are absent. They produced noise or changed valid code without a dependable correctness signal.
- The package-local plugin also enables 14 TypeScript safety rules by default: assertion-chain,
  conditional-spread, known-value-widening, module-mocking, object-parameter, Reflect, runtime
  `typeof`, symbol-name, unknown-boundary, and dictionary checks. They remain under
  the existing `thethracian` namespace and are all errors.
- Explicit predicate and assertion functions may use runtime `typeof`; ordinary ad hoc narrowing
  remains banned. Predicate calls do not discard caller type evidence and are not widening.
  `typescript/no-unnecessary-type-parameters` is omitted because its broad-type replacements
  conflict with the generic boundary rules.
- Preserve the 14 imported generic rules and `no-service-constructor-imports`.
  The separate TypeScript `no-comments` rule is deleted. Effect is disabled by default;
  `effect: true` enables all 35 retained Effect rules plus the service-constructor rule.
  The retained set includes 12 canonical-pattern guardrails documented in `ts/README.md`.
  Other deleted Effect rules remain absent, with no warnings or optional registrations.
  The public option is `effect?: boolean`; nonboolean values throw `TypeError`.
- Semantic `thx-codemod-fix` rewrites remain available as an explicit migration command, but are not part of lint fixes or staged-file hooks.

Current implementation:

- TypeScript/Effect: retain the 18 safety rules plus `effect-no-known-fake-api`, `effect-require-service-self-match`, `effect-no-focused-effect-tests`, `effect-no-skipped-effect-tests`, `effect-no-runSync-in-server-request-handlers`, and 12 canonical-pattern guardrails listed in `ts/README.md`. All 35 are errors with `effect: true`, alongside the service-constructor rule. The old strict selections, path groups, and public strict/options types are removed. Internal default and strict name lists contain 34 and one rule respectively; these do not expose separate consumer options.
- TypeScript/Oxlint: `max-lines` (5,000 lines, excluding blank lines and comments), `max-depth` (5 levels), `max-nested-callbacks` (6 levels), `max-params` (7 params), `max-lines-per-function` (150 lines), and `complexity` (10) are errors. Safety rules include `no-debugger`, `no-empty` (with `allowEmptyCatch: false`), `no-eval`, `no-new-func`, `no-script-url`, `prefer-const`, `preserve-caught-error`, strict equality, and type-aware unsafe/async operations. Line width is formatter-owned; global `console`, noisy naming, null, ternary, magic-number, import-count, documentation, and absolute `any`/assertion bans are intentionally absent.
- Rust: rustfmt uses `max_width = 150`; Clippy uses `too-many-arguments-threshold = 5`, `excessive-nesting-threshold = 3`, `too_many_lines = "deny"`, `too-many-lines-threshold = 75`, `print_stdout = "deny"`, `print_stderr = "deny"`, `todo = "deny"`, `unwrap_used = "deny"`, `expect_used = "deny"`, `unused_result_ok = "deny"` (calling .ok() discards errors), `as_conversions = "deny"` (no implicit type coercion via `as`), and `wildcard_enum_match_arm = "deny"` (restriction); pedantic group covers `dbg_macro`, `match_wild_err_arm`, `unused_async`, `match_wildcard_for_single_variants`, `cast_possible_truncation`, `cast_sign_loss`, `cast_lossless`, `unnecessary_mut_passed`, and `mut_mut`; rustc lints `unsafe_code` (`forbid`), `missing_debug_implementations`, `unused_must_use`, `unused_mut`, and `unused_crate_dependencies` are all `deny`; silent error swallowing is handled by `unused_must_use` (ignored Results), `unused_result_ok` (discarded errors via .ok()), and compiler exhaustiveness (Rust has no catch/empty catch equivalent); immutability is enforced by Rust's `let`/`let mut` semantics plus `unused_mut` and pedantic Clippy mutability lints; tests are granted unwrap/expect/panic exceptions via clippy.toml. `cargo thx-lint check` rejects lexical comments with a compiler-derived lexer; Clippy alone cannot enforce this. Documentation requirements are disabled, including inherited Clippy `missing_errors_doc`, `missing_panics_doc`, and `missing_safety_doc`.
- Elixir: Credo uses `MaxLineLength`, `Nesting` (3 levels), `FunctionArity` (5 params), `CyclomaticComplexity` (10), `IoInspect`, `IExPry`, `VariableRebinding`, `Specs` (every public function requires @spec), and a custom shipped `FunctionBodyLength` check, all with failing exit status. Dialyxir snippet uses `:unmatched_returns` (catches unhandled return values including async operations and incomplete pattern matches), `:underspecs`, `:no_return`, `:error_handling`, `:extra_return`, and `:missing_return` flags; Elixir has no static exhaustive pattern match checker, but Dialyzer's type narrowing and unmatched returns cover the closest equivalents; immutability is enforced by Elixir's immutable data structures plus `VariableRebinding` to forbid variable rebinding within a scope.

## Ways Of Working

Elixir's shipped `NoComments` check rejects lexical comments and clears inline Credo suppressions.
Elixir documentation attributes remain allowed. CI and pre-push run `lint:projects` for all three languages.

### Working on retained Effect rules

Effect checks are package behavior, not a replacement for the upstream Oxlint allowlist. Keep
the 35 retained rules explicit, import-aware, and error-only. Preserve the imported 14 generic
rules and service-constructor rule. Add a new Effect rule only when it has a reproducible
correctness, resource-safety, or deliberate canonical-pattern signal. Opinionated rules must
reliably identify their target and avoid semantic damage or superficial lint evasion. Boundary
rules remain deleted from this shared preset; consuming repositories own their architecture
contracts and any path/import boundary enforcement. Update
`ts/README.md`, tests, and boolean-option validation together.

Use the existing package boundaries. Do not split a language across multiple top-level folders unless there is a concrete package boundary that needs independent publishing.

When adding a new language:

1. Add one top-level folder for that language.
2. Add a package under the language's idiomatic package ecosystem and naming shape.
3. Keep all exported config assets for that language inside that folder.
4. If the language has idiomatic importable shared config support, prefer a direct import package.
5. If the language expects config files in the consumer repo, add an installer in that language's package.
6. Add an Nx `project.json` with `build`, `check`, `lint`, `test`, and `pack` targets matching the language's native tools.
7. Update the root README and this file when the architecture changes.

When changing exported config behavior:

- Modify the package that ships the config, not only this repo's local lint setup.
- Update the native installer if downstream repositories need additional files copied or managed blocks updated.
- Update the package README so consumers can see the behavior.
- Add or update package checks so missing config assets are caught.
- Verify the rule with the real downstream tool when practical, especially for custom checks or tool-specific severity.

When changing repo tooling:

- Normal lint commands, staged hooks, and Nx TypeScript lint use the locally built package.
  `lint:published:type-aware` is reserved for validating the installed published consumer config.
  Both configs share `oxlint.repository.mjs`. Repository configuration calls
  `factory({ effect: true, typeAware: true })` and adds ignores, without extra rules or path groups.
  The local config enables 210 errors: 160 reviewed native rules, 14 generic rules, the
  service-constructor rule, and all 35 retained Effect rules. With `typeAware: true`, the base preset
  enables 174 errors; syntax-only totals are 143 without Effect and 179 with Effect.
  The installed published factory still enables 193 errors with Effect: 159 native, 15 generic,
  18 safety rules, and the service-constructor rule, until the new package is published.
  Repository lint scans all owned TypeScript from the root, including non-test fixtures, while
  excluding tests, scripts, benchmarks, JavaScript, and generated/dependency output. Test programs
  remain typechecked separately; invalid minimum-peer programs use their compatibility harness.

- Keep root scripts aligned with Nx targets.
- Prefer `pnpm run lint`, `pnpm run check`, `pnpm run test:projects`, `pnpm run build`, and `pnpm run knip:ci`.
- Hooks are managed through Husky and `prek.toml`; keep monorepo-level hooks at the root.
- Do not bypass hooks by duplicating package-specific shell logic unless the hook tool cannot express the behavior.

## Commands

Common commands:

```sh
mise install
mise exec -- pnpm run check
pnpm install
pnpm run lint
pnpm run lint:ci
pnpm run check
pnpm run test:projects
pnpm run build
pnpm run knip:ci
pnpm release:dry-run
```

Useful Nx commands:

```sh
pnpm nx graph
pnpm nx affected -t lint
pnpm nx affected -t check
pnpm nx affected -t test
pnpm nx affected -t build
```

## Git And Release Notes

Use lowercase conventional commits. Examples:

- `feat: add ruby lint config`
- `fix: copy elixir credo checks`
- `chore: update workspace hooks`

Publishing is owned by GitHub Actions. Do not manually publish from local agent sessions unless explicitly asked.

## Important Constraints

- The repo is MIT licensed.
- Package publication targets are npm for TypeScript, crates.io for Rust, and Hex for Elixir.
- Keep npm package names flat under `@thethracian`; npm does not support deeper scoped package namespaces like `@thethracian/linters/oxlint-config`.
- Avoid broad refactors while changing a specific lint config.
- Do not revert unrelated user changes in the worktree.

## TDD-First Protocol (MANDATORY)

You MUST follow Red → Green → Refactor for every new feature or bug fix.

### Phase 1: RED (Write Tests)

1. Read the task specification carefully.
2. Write test file(s) covering happy path, edge cases, and error cases.
3. Run tests: they MUST FAIL. If they pass, the test is wrong — rewrite it.
4. Show me the failing test output as proof.

### Phase 2: GREEN (Minimum Implementation)

5. Write the MINIMUM code to make tests pass. No extra features.
6. Run tests: they MUST PASS.
7. Run compiler/linter: MUST PASS.

### Phase 3: REFACTOR (Clean Up)

8. Refactor for clarity, performance, idiomatic style.
9. Run tests after each refactor: they must stay passing.
10. Add native typespecs and external documentation for complex logic; do not add source comments.
11. Run full quality pipeline.

### CRITICAL RULES

- NEVER write implementation and tests in the same response.
- If you add a feature later, you MUST add tests FIRST (new RED phase).
- If tests are failing after your changes, fix the IMPLEMENTATION, not the tests.
- Exception: fixing a test that was testing wrong behavior (document why).

### Verification

Before declaring complete, paste:

- Test count: X tests, Y failures, Z skipped
- Coverage: %
- Linter: clean / zero warnings
