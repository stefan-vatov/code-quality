# The Thracian - Code Quality

<div align="center">

An experimental, painfully strict, very opinionated, versioned lint packages for TypeScript, Rust, and Elixir and agentic coding.

[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![TypeScript Oxlint](https://img.shields.io/badge/TypeScript-Oxlint-3178c6?logo=typescript&logoColor=white)
![Rust Cargo](https://img.shields.io/badge/Rust-Cargo-b7410e?logo=rust&logoColor=white)
![Elixir Hex](https://img.shields.io/badge/Elixir-Hex-4b275f?logo=elixir&logoColor=white)
![Nx workspace](https://img.shields.io/badge/workspace-Nx-143055?logo=nx&logoColor=white)
![Strict policy](https://img.shields.io/badge/policy-strict_by_default-black)

</div>

```console
$ cargo thx-lint init --write
Applied 5 operation(s):
- manage rustfmt.toml
- manage clippy.toml
- patch Cargo.toml

$ mix thx_lint.install --yes
Installed The Thracian Elixir lint setup

$ pnpm exec oxlint . --type-aware --type-check
Found 0 warnings and 0 errors.
```

This repository is the source of truth for The Thracian code-quality policy. It packages the
same strict linting stance for each ecosystem in the way that ecosystem expects to consume it:
an importable Oxlint config for TypeScript, a Cargo subcommand for Rust, and a Credo plugin with
a Mix installer for Elixir.

## Why Use It

- Native package delivery - npm for TypeScript, crates.io for Rust, and Hex for Elixir.
- Strict defaults - violations fail instead of drifting into warning-only cleanup work.
- Versioned installs - downstream projects can update deliberately and rerun installers safely.
- Real tool integration - Oxlint, rustfmt, Clippy, Cargo lints, Credo, and Dialyxir-compatible config.
- Monorepo maintenance - one policy repository with separate package READMEs and native pack targets.

## Packages

| Package                                      | Registry                                                        | Consumer entrypoint                                    | Purpose                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [`@thethracian/oxlint-config`](ts/README.md) | [npm](https://www.npmjs.com/package/@thethracian/oxlint-config) | `import theThracian from "@thethracian/oxlint-config"` | TypeScript/Oxlint config with custom JS plugin rules.                                    |
| [`cargo-thx-lint`](rust/README.md)           | [crates.io](https://crates.io/crates/cargo-thx-lint)            | `cargo thx-lint init --write`                          | Rust installer for `rustfmt.toml`, `clippy.toml`, Cargo lint tables, and a Dylint check. |
| [`the_thracian_credo`](elixir/README.md)     | [Hex](https://hex.pm/packages/the_thracian_credo)               | `mix thx_lint.install --yes`                           | Credo plugin, custom checks, formatter setup, and Dialyxir helper config.                |

## Quick Start

Use the package for your ecosystem.

### TypeScript

```sh
pnpm add -D @thethracian/oxlint-config oxlint@^1.63.0
```

```ts
import theThracian from '@thethracian/oxlint-config';

export default theThracian();
```

### Rust

```sh
cargo install cargo-thx-lint
cargo thx-lint init --write
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
```

The installer is idempotent. Managed files and Cargo manifest regions are replaced in place on
rerun, and legacy npm-wrapper markers are migrated automatically.

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

## Rules At A Glance

| Policy                | TypeScript                          | Rust                                    | Elixir                                               |
| --------------------- | ----------------------------------- | --------------------------------------- | ---------------------------------------------------- |
| Line width            | 150                                 | 150                                     | 150                                                  |
| Function length       | 75 lines                            | 75 lines                                | 75 lines                                             |
| Nesting depth         | 3                                   | 3                                       | 3                                                    |
| Parameter count       | 5                                   | 5                                       | 5                                                    |
| Complexity            | 10                                  | Clippy-supported limits                 | 10                                                   |
| Debug artifacts       | `console`, `debugger`               | `dbg!`, `print!`, `println!`            | `IO.inspect`, `IEx.pry`                              |
| Unsafe escape hatches | unsafe `any` operations             | `unsafe_code`, lossy `as` casts         | underspecified public APIs via Credo/Dialyzer config |
| Immutability pressure | `prefer-const`, `no-param-reassign` | `unused_mut`, pedantic mutability lints | `VariableRebinding`                                  |

The full rule lists live in the package READMEs because each ecosystem has different tool
names, limits, and unavoidable tradeoffs.

## Working On This Repo

```sh
pnpm install
pnpm run lint:ci
pnpm run check
pnpm run test:projects
pnpm run build
pnpm nx run-many -t pack
```

This is a pnpm and Nx workspace. TypeScript is packed through npm tooling, Rust through Cargo,
and Elixir through Mix/Hex. The root package is private and only owns workspace orchestration.

## Release Shape

Each package is published independently:

- `ts/` publishes `@thethracian/oxlint-config` to npm.
- `rust/` publishes `cargo-thx-lint` to crates.io.
- `elixir/` publishes `the_thracian_credo` to Hex.

Releases are CI-owned. After a Conventional Commit lands on `main`, GitHub Actions validates the
repo, updates package versions and changelogs, commits that release metadata back to `main`,
publishes changed packages from the release commit, and then tags the published package versions.

The release workflow expects a GitHub environment named `release`. npm publishes through trusted
publishing from `.github/workflows/release.yml` with the same `release` environment, so no npm token
is required. For first Rust publishes, configure `CARGO_REGISTRY_TOKEN` as an environment secret
unless crates.io trusted publishing is already configured. Hex publishing uses a scoped `HEX_API_KEY`
environment secret. Branch protection must also allow this workflow to push release metadata commits
and package tags, either through `GITHUB_TOKEN` permissions or an approved bot token.

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
