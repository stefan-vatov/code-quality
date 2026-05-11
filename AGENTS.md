# Agent Guide

## Purpose

This repository is the source of truth for The Thracian linting configuration packages. It publishes language-specific lint configs through npm so they can be versioned, consumed, and updated consistently across other repositories.

The repo is intentionally small and practical: keep each language package self-contained, avoid repo sprawl, and make every exported config usable by downstream projects without requiring consumers to understand this monorepo.

## Architecture

This is a pnpm + Nx monorepo. Each package lives at the repository root in a single folder:

- `ts/`: `@thethracian/oxlint-config`
  - Importable first-party Oxlint config for TypeScript projects.
  - Consumers import this package directly from their Oxlint config.
- `rust/`: `@thethracian/rust-lint-config`
  - Versioned Rust config assets for rustfmt, Clippy, and Cargo lint tables.
  - Consumers receive these files through the patcher CLI.
- `elixir/`: `@thethracian/elixir-lint-config`
  - Versioned Elixir config assets for Credo and Dialyxir.
  - Consumers receive these files through the patcher CLI.
- `cli/`: `@thethracian/lint-cli`
  - Patcher CLI for ecosystems without idiomatic first-party shared config support.
  - The executable name is `thx-lint-cli`.
  - Currently patches Rust and Elixir projects.

The root workspace owns tooling only: Nx project orchestration, Oxlint/Oxfmt for this repo, Vitest/Stryker test wiring, Knip, and hooks.

## Quality Gates

Exported configs should be strict by default. Current cross-language policy:

- Maximum cyclomatic complexity: 10 where the language tool supports a reliable metric.
- No debug artifacts in production code: ban console.log, dbg!, print!, println!, todo!, IO.inspect, IEx.pry, etc.
- No commented-out code or inline explanatory text: prevent dead code in comments and inline explanations that waste context tokens.
  - TypeScript uses our custom `thethracian/no-commented-out-code` Oxlint rule (shipped with the config).
- No silent catch: empty catch/rescue blocks are forbidden; all exceptions must be routed to a logger, error reporter, or re-raised.
- No stale suppressions: every suppression must name the exact rule and include a reason; unused disables fail.
- No unhandled async work: promises/futures/results must be awaited, returned, or explicitly handled.
- Exhaustiveness required: unions/enums must be exhaustively handled in switch/match statements.
- No unchecked dynamic escape hatches: ban constructs that bypass the type system (unsafe any operations, wildcard enum matches, underspecified function specs).
- Maximum file length: 500 lines where the language tool supports file line counts.
- Maximum line width: 150 characters where the language tool supports line width.
- Maximum nesting depth: 3 levels.
- Maximum function length: 75 lines.
- All rules use the strictest severity available (error/deny/forbid). No warnings allowed — the config is super-strict by design.

Current implementation:

- TypeScript/Oxlint: `max-depth` (3 levels), `max-len` (150 chars), `max-params` (5 params), `max-lines`, `max-lines-per-function`, `complexity/complexity` with `cyclomatic: 10` (via `oxlint-plugin-complexity`), `thethracian/no-commented-out-code` (custom rule, shipped with config), `no-console`, `no-debugger`, `no-empty` (with `allowEmptyCatch: false`), `no-inline-comments`, `no-warning-comments`, `no-unsafe-call`, and `no-unsafe-member-access` are `error`; `no-unsafe-assignment`, `no-unsafe-return`, `no-unsafe-argument`, `no-floating-promises`, `no-misused-promises`, and `switch-exhaustiveness-check` are `error` when type-aware.
- Rust: rustfmt uses `max_width = 150`; Clippy uses `too-many-arguments-threshold = 5`, `excessive-nesting-threshold = 3`, `too_many_lines = "deny"`, `too-many-lines-threshold = 75`, `print_stdout = "deny"`, `print_stderr = "deny"`, `todo = "deny"`, and `wildcard_enum_match_arm = "deny"` (restriction); pedantic group covers `dbg_macro`, `match_wild_err_arm`, `unused_async`, `match_wildcard_for_single_variants`, `cast_possible_truncation`, `cast_sign_loss`, and `cast_lossless`; rustc lints `unused_must_use` and `non_exhaustive_omitted_patterns` are `deny`; silent error swallowing is handled by `unused_must_use` (ignored Results) and compiler exhaustiveness (Rust has no catch/empty catch equivalent).
- Elixir: Credo uses `MaxLineLength`, `Nesting` (3 levels), `FunctionArity` (5 params), `CyclomaticComplexity` (10), `IoInspect`, `IExPry`, and a custom shipped `FunctionBodyLength` check, all with failing exit status. Dialyxir snippet uses `:unmatched_returns` (catches unhandled return values including async operations and incomplete pattern matches), `:underspecs`, `:no_return`, `:error_handling`, `:extra_return`, and `:missing_return` flags; Elixir has no static exhaustive pattern match checker, but Dialyzer's type narrowing and unmatched returns cover the closest equivalents.

## Ways Of Working

### Writing custom Oxlint rules

See `SKILL.md` for the complete workflow for writing custom Oxlint JS plugin rules in this repository.

Use the existing package boundaries. Do not split a language across multiple top-level folders unless there is a concrete package boundary that needs independent publishing.

When adding a new language:

1. Add one top-level folder for that language.
2. Add a package under the `@thethracian/*-lint-config` naming shape unless there is a strong reason not to.
3. Keep all exported config assets for that language inside that folder.
4. If the language has idiomatic importable shared config support, prefer a direct import package.
5. If the language expects config files in the consumer repo, extend `@thethracian/lint-cli` to patch those files.
6. Add an Nx `project.json` with `build`, `check`, `lint`, `test`, and `pack` targets matching the existing packages.
7. Update the root README and this file when the architecture changes.

When changing exported config behavior:

- Modify the package that ships the config, not only this repo's local lint setup.
- Update the patcher CLI if downstream repositories need additional files copied or managed blocks updated.
- Update the package README so consumers can see the behavior.
- Add or update package checks so missing config assets are caught.
- Verify the rule with the real downstream tool when practical, especially for custom checks or tool-specific severity.

When changing repo tooling:

- Keep root scripts aligned with Nx targets.
- Prefer `pnpm run lint`, `pnpm run check`, `pnpm run test:projects`, `pnpm run build`, and `pnpm run knip:ci`.
- Hooks are managed through Husky and `prek.toml`; keep monorepo-level hooks at the root.
- Do not bypass hooks by duplicating package-specific shell logic unless the hook tool cannot express the behavior.

## Commands

Common commands:

```sh
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
- `chore: update monorepo hooks`

Publishing is expected to happen through GitHub Actions later. Do not manually publish from local agent sessions unless explicitly asked.

## Important Constraints

- The repo is MIT licensed.
- Package publication target is npm.
- Keep package names flat under `@thethracian`; npm does not support deeper scoped package namespaces like `@thethracian/linters/oxlint-config`.
- Avoid broad refactors while changing a specific lint config.
- Do not revert unrelated user changes in the worktree.
