# cargo-thx-lint

<p align="center">
  <a href="https://crates.io/crates/cargo-thx-lint"><img alt="crates.io version" src="https://img.shields.io/crates/v/cargo-thx-lint?style=flat-square"></a>
  <a href="https://docs.rs/cargo-thx-lint"><img alt="docs.rs" src="https://img.shields.io/docsrs/cargo-thx-lint?style=flat-square"></a>
  <a href="https://github.com/stefan-vatov/code-quality/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/stefan-vatov/code-quality/ci.yml?branch=main&style=flat-square"></a>
  <a href="https://github.com/stefan-vatov/code-quality/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
</p>

`cargo-thx-lint` installs The Thracian Rust lint policy into a Cargo package or workspace.

```text
cargo thx-lint init --write
  writes rustfmt.toml
  writes clippy.toml
  patches Cargo.toml lint tables
  vendors the max-directory-depth Dylint check
```

## Why Use It

- One command to install the policy: no copied snippets from a README into multiple repos.
- Strict Rust defaults: unsafe code, debug output, discarded results, wildcard enum matches, unchecked casts, `unwrap`, and `expect` are denied.
- Agent-friendly guardrails: file shape, nesting, function length, argument count, docs, and directory depth are enforced before review.
- Idempotent updates: rerun the installer and managed regions are replaced in place.
- Works with normal Cargo tooling: after install, you still use `cargo fmt`, `cargo clippy`, and `cargo test`.

## Install

```sh
cargo install cargo-thx-lint
cargo thx-lint init --write
```

Validate the installed policy:

```sh
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
```

Update later with the same installer:

```sh
cargo install cargo-thx-lint --force
cargo thx-lint update --write
```

## What It Installs

| File or region              | Purpose                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `rustfmt.toml`              | Sets the formatting policy, including 150-character line width                      |
| `clippy.toml`               | Configures strict Clippy thresholds such as function length, nesting, and arguments |
| `Cargo.toml` lint tables    | Enables deny-level Rust and Clippy lints for packages or workspaces                 |
| `.thethracian-checks/depth` | Vendors the Dylint source for maximum source directory depth                        |

Managed regions include a version marker:

```toml
# BEGIN cargo-thx-lint
# VERSION 0.1.0
# END cargo-thx-lint
```

Legacy regions from `@thethracian/rust-lint-config` are migrated automatically.

## Policy Highlights

| Area            | Policy                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Shape           | 150-character lines, 75-line functions, max nesting depth 3, max 5 arguments                        |
| Safety          | `unsafe_code` is forbidden, `as` conversions are denied, wildcard enum match arms are denied        |
| Error handling  | discarded `Result`s, `.ok()` error swallowing, `unwrap`, and `expect` are denied                    |
| Debug artifacts | `dbg!`, stdout printing, stderr printing, and TODOs are denied                                      |
| Maintainability | missing docs, missing debug implementations, unused crates, and unnecessary mutability are denied   |
| Structure       | source files more than 4 directories below the package root are rejected by the custom Dylint check |

## Local Development

Use a local checkout when changing the package itself:

```sh
cargo install --path /path/to/linters/rust --force
cargo thx-lint init --write --cwd /path/to/consumer
```

## Registry Links

- crates.io: <https://crates.io/crates/cargo-thx-lint>
- docs.rs: <https://docs.rs/cargo-thx-lint>
- Source: <https://github.com/stefan-vatov/code-quality/tree/main/rust>
- Issues: <https://github.com/stefan-vatov/code-quality/issues>

## License

MIT. See [LICENSE](LICENSE).
