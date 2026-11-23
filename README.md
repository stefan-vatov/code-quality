# The Thracian - Code Quality

<div align="center">

An experimental, painfully strict, versioned set of lint packages for TypeScript, Rust, and
Elixir.

[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![TypeScript Oxlint](https://img.shields.io/badge/TypeScript-Oxlint-3178c6?logo=typescript&logoColor=white)
![Rust Cargo](https://img.shields.io/badge/Rust-Cargo-b7410e?logo=rust&logoColor=white)
![Elixir Hex](https://img.shields.io/badge/Elixir-Hex-4b275f?logo=elixir&logoColor=white)
![Nx workspace](https://img.shields.io/badge/workspace-Nx-143055?logo=nx&logoColor=white)
![Strict policy](https://img.shields.io/badge/policy-strict_by_default-black)

</div>

This repository is the source of truth for The Thracian code-quality policy. It packages the same
strict stance for each ecosystem in the way that ecosystem expects to consume it: an importable
Oxlint config for TypeScript, a Cargo subcommand for Rust, and a Credo plugin with a Mix installer
for Elixir.

## Why Use It

- Native package delivery: npm for TypeScript, crates.io for Rust, and Hex for Elixir.
- Strict defaults: an active violation fails the lint run; there is no warning tier.
- High signal: the TypeScript base preset is an explicit allowlist of approved upstream Oxlint
  rules. Rules that the audit found noisy or behavior-changing are not selected.
- Versioned installs: downstream projects can update deliberately and rerun installers safely.
- Real tool integration: Oxlint, rustfmt, Clippy, Cargo lints, Credo, and Dialyzer-compatible
  configuration.

## Packages

| Package                                      | Registry                                                        | Consumer entrypoint                                    | Purpose                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [`@thethracian/oxlint-config`](ts/README.md) | [npm](https://www.npmjs.com/package/@thethracian/oxlint-config) | `import theThracian from "@thethracian/oxlint-config"` | Upstream Oxlint allowlist, 17 TypeScript safety rules, plus opt-in Effect checks.        |
| [`cargo-thx-lint`](rust/README.md)           | [crates.io](https://crates.io/crates/cargo-thx-lint)            | `cargo thx-lint init --write`                          | Rust installer for `rustfmt.toml`, `clippy.toml`, Cargo lint tables, and a Dylint check. |
| [`the_thracian_credo`](elixir/README.md)     | [Hex](https://hex.pm/packages/the_thracian_credo)               | `mix thx_lint.install --yes`                           | Credo plugin, custom checks, formatter setup, and Dialyzer helper configuration.         |

## Quick Start

Use the package for your ecosystem.

### TypeScript

```sh
pnpm add -D @thethracian/oxlint-config oxlint@^1.66.0
```

```js
// oxlint.config.mjs
import theThracian from '@thethracian/oxlint-config';

export default theThracian();
```

For normal fixes, use Oxlint's own safe fixes:

```json
{
  "scripts": {
    "lint": "oxlint src",
    "lint:fix": "oxlint src --fix",
    "lint:type-aware": "oxlint src --type-aware --type-check"
  }
}
```

The base TypeScript preset has one severity: every selected rule is an `error`. It is built from an
explicit approved upstream allowlist; unapproved upstream rules are absent rather than disabled by
individual `off` entries. Oxlint's implicit `correctness` warnings are cleared once, at category
level, before the allowlist is applied. That reset prevents hidden defaults from leaking noise into
the result; it does not add warnings or weaken any selected rule.

The package also enables 17 package-local TypeScript safety rules by default. They cover
`try`/`catch`/`throw`, evidence-preserving assertions, unknown/object boundaries, runtime reflection,
module mocking, unsafe type-shape contracts, and quadratic array pipelines. The rules share the `thethracian` plugin namespace.
See the [TypeScript package README](ts/README.md) for the full list.

The package also ships 35 Effect checks: the 18 safety rules plus fake-API, service-self-match,
focused-test, skipped-test, synchronous server-handler checks, and 12 canonical-pattern guardrails.
`effect: true` enables all 35
and the protected service-constructor import rule. The public option is boolean-only; nonboolean
values throw `TypeError`. All other Effect rules are physically deleted, with no warnings or
optional registrations. Strict rule selections and path groups are removed. See the
[TypeScript package README](ts/README.md) for the complete API and rule behavior.

Semantic `thx-codemod-fix` rewrites remain available as explicit, reviewed migration commands. They
are never invoked by Oxlint, `lint:fix`, `lint-staged`, or other automatic lint hooks. They need
`jscodeshift` installed separately; the package does not declare it, so lint-only consumers never
install it.

### Rust

```sh
cargo install cargo-thx-lint
cargo thx-lint init --write
cargo fmt --all -- --check
cargo thx-lint check
cargo clippy --all-targets -- -D warnings
```

The installer is idempotent. Managed files and Cargo manifest regions are replaced in place on
rerun, and legacy npm-wrapper markers are migrated automatically.

`cargo thx-lint check` rejects lexical Rust comments, including documentation comments, using a
compiler-derived lexer. This is a separate stable Cargo check; Clippy alone does not enforce it.

### Elixir

```elixir
defp deps do
  [
    {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
    {:the_thracian_credo, "~> 0.1.0", only: [:dev, :test], runtime: false}
  ]
end
```

```sh
mix deps.get
mix thx_lint.install --yes
mix credo --strict
```

The installer preserves existing Credo config when it can patch it safely, writes versioned
managed blocks for owned config, and can be rerun after package upgrades.

Rust and Elixir ban lexical source comments. Literal strings containing comment markers are
allowed, as are interpreter shebangs and Elixir documentation attributes. Elixir ships `NoComments`;
Rust enforces its ban through `cargo thx-lint check`. TypeScript/JavaScript no longer ship
`thethracian/no-comments`; the 16 imported generic rules remain protected.
Repository CI and pre-push run `pnpm run lint:projects` to enforce all three language policies.

## Rules At A Glance

| Policy                | TypeScript                                   | Rust                                    | Elixir                                               |
| --------------------- | -------------------------------------------- | --------------------------------------- | ---------------------------------------------------- |
| Line width            | Formatter-owned (no lint cap)                | 150                                     | 150                                                  |
| Function length       | 150 lines                                    | 75 lines                                | 75 lines                                             |
| Nesting depth         | 5                                            | 3                                       | 3                                                    |
| Parameter count       | 7                                            | 5                                       | 5                                                    |
| Complexity            | 10                                           | Clippy-supported limits                 | 10                                                   |
| File/import caps      | 5,000 lines; no import-count cap             | Package-specific                        | Package-specific                                     |
| Debug artifacts       | `debugger`; `console` remains contextual     | `dbg!`, `print!`, `println!`            | `IO.inspect`, `IEx.pry`                              |
| TypeScript safety     | 17 rules including the `try` and `throw` ban | —                                       | —                                                    |
| Unsafe escape hatches | Upstream type-aware unsafe-operation rules   | `unsafe_code`, lossy `as` casts         | Underspecified public APIs via Credo/Dialyzer config |
| Immutability pressure | `prefer-const`                               | `unused_mut`, pedantic mutability lints | `VariableRebinding`                                  |

The TypeScript profile caps files at 5,000 lines, excluding blank lines and comments, and has no
import-count rule. General naming preferences are absent except for the imported symbol-name rule;
null bans, ternary bans, magic-number bans, global line-length and `console` bans, and documentation
requirements are likewise absent from the base allowlist because they generated noise or changed
valid code without a dependable correctness signal.

Explicit `any` annotations, non-null assertions, and boundary type assertions remain available for
framework, generated-code, validated-brand, and interop boundaries. Type-aware upstream rules still
reject unsafe calls, member access, assignments, arguments, returns, floating promises, and
misused promises when those checks are requested.

## Working On This Repo

Install the repository-pinned Node, pnpm, Erlang, and Elixir toolchain with mise:

```sh
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm run check
```

With mise activated in your shell, the commands below use those versions automatically. Otherwise,
prefix them with `mise exec --`. Rust uses the stable toolchain installed through rustup.

```sh
pnpm install
pnpm run lint:policy
pnpm run lint:ci
pnpm run check
pnpm run test:projects
pnpm run build
pnpm nx run-many -t pack
```

This is a pnpm and Nx workspace. TypeScript is packed through npm tooling, Rust through Cargo, and
Elixir through Mix/Hex. The root package is private and owns workspace orchestration only.

`lint`, `lint:fix`, the type-aware variants, staged hooks, and the Nx TypeScript lint target
build and use the local TypeScript package. Both local and published configs share
`oxlint.repository.mjs`, which calls `factory({ effect: true, typeAware: true })` and adds ignores.
Local lint enables 229 errors across 176 native rules, 17 base package rules, 35 Effect rules, and
the service-constructor rule. The base preset enables 193 errors with `typeAware: true`. Syntax-only
totals are 162 without Effect and 198 with it. Unused disable directives are errors. Repository lint scans from the root and includes
non-test fixtures.
Tests, scripts, and benchmarks are excluded, as are JavaScript and generated/dependency output;
the scope is owned TypeScript (`.ts`, `.tsx`, `.mts`, `.cts`). Tests remain typechecked separately.

Repository configuration adds one repository-only rule, `go-internal/boundaries` from
`oxlint-plugin-go-internal`, which enforces Go-style `internal/` directory boundaries in this repo.
It is not part of the published preset, and no path groups are added. The installed published 0.11.0 factory
also enables 227 errors with Effect (174 native, 17 base package rules, 35 Effect rules, and the
service-constructor rule).

`pnpm run lint:published:type-aware` checks the installed published package independently. The
release workflow runs it after every TypeScript publish, as described below.

## Release Shape

Each package is published independently:

- `ts/` publishes `@thethracian/oxlint-config` to npm.
- `rust/` publishes `cargo-thx-lint` to crates.io.
- `elixir/` publishes `the_thracian_credo` to Hex.

Releases are CI-owned. After a Conventional Commit lands on `main`, GitHub Actions validates the
repo, updates package versions and changelogs, commits that release metadata back to `main`,
publishes changed packages from the release commit, and tags the published package versions.

After a TypeScript publish, the `verify published npm consumption` job pins the new version in the
root `package.json` and commits `ci(ts): use published oxlint config <version>` to `main`. npm
[scans new versions for malware before serving them](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/),
which typically takes about five minutes and can take 15 or more. So the job first runs
`scripts/wait-for-npm-version.sh`, which polls `npm view` every 15 seconds for up to 20 minutes.
It then installs the exact published version and runs `lint:published:type-aware` before
committing. If npm takes longer than 20 minutes, re-run only the failed job with
`gh run rerun <run-id> --failed`.

## Documentation

- [TypeScript package README](ts/README.md)
- [Rust package README](rust/README.md)
- [Elixir package README](elixir/README.md)
- [Agent and maintainer guide](AGENTS.md)

## Contributing

Keep changes scoped to the package that owns the behavior. When changing exported config, update
the package README and add or adjust tests that prove downstream projects receive the intended
rules.

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
