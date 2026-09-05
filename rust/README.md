# cargo-thx-lint

<p align="center">
  <a href="https://crates.io/crates/cargo-thx-lint"><img alt="crates.io version" src="https://img.shields.io/crates/v/cargo-thx-lint?style=flat-square"></a>
  <a href="https://docs.rs/cargo-thx-lint"><img alt="docs.rs" src="https://img.shields.io/docsrs/cargo-thx-lint?style=flat-square"></a>
  <a href="https://github.com/stefan-vatov/code-quality/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/stefan-vatov/code-quality/ci.yml?branch=main&style=flat-square"></a>
  <a href="https://github.com/stefan-vatov/code-quality/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
</p>

`cargo-thx-lint` installs The Thracian experimental, painfully strict, very opinionated Rust lint policy into a Cargo package or workspace and provides a stable Rust comment linter.

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
- Guardrails: nesting, function length, argument count, and comment-free Rust sources are enforced before review.
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
cargo thx-lint check
cargo clippy --all-targets -- -D warnings
```

`cargo thx-lint check` is required in consumer lint scripts and CI. It is a native Cargo
subcommand, not a Clippy plugin: `cargo clippy` alone does not enforce the comment ban.
The repository's Nx Rust lint target runs the locally built check alongside fmt and Clippy.

The check uses Cargo metadata to find every workspace member, including when invoked from
a member subdirectory with `--cwd`. It scans `.rs` files beneath each member's manifest
directory, including tests, examples, build scripts, disabled `cfg` code, and embedded
sources under `configs`. A virtual workspace with no members has no package sources to scan.
Sources outside member directories (such as external `#[path]` modules) must be moved into
the scanned tree to receive this check.

It skips directories named `.git`, `target`, `deps`, `vendor`, `.thethracian-checks`, and
`node_modules`, plus Cargo's configured target directory, including links at those excluded
locations. Keep first-party code outside these reserved dependency/output directories.
Within the selected tree, `.rs` symlinks and directory symlinks are rejected with an
`error[no-comments]` diagnostic instead of silently skipped. Broken or unresolvable links
also fail closed; links to regular non-Rust files are ignored. Use regular files and
directories for first-party Rust sources. Directory links are never traversed, so loops
cannot hang the scan. Cargo metadata
runs offline without resolving dependencies; an invalid workspace, unreadable source, or
invalid UTF-8 causes failure.

All line and block comments are errors, including documentation comments, nested block
comments, and unterminated block comments. Diagnostics use `path:line:column` and the
`no-comments` rule name; violations produce a nonzero exit status. Comment-like text in
strings, raw strings, byte strings, C strings, characters, and the initial interpreter
directive is accepted. Positions advance once per token, so tracking remains linear even
in comment-dense files; columns count Unicode characters. The check does not ban `#[doc]`
attributes or replace compiler syntax checking.

The lexer is pinned to `ra-ap-rustc_lexer` 0.100.0, an automatically published snapshot
of Rust's compiler lexer with C-string support. The package supports Rust 1.85 and newer
without nightly compiler libraries. Lexer upgrades must retain literal/comment regression
coverage and pass the Rust 1.85 build.

Documentation is optional: `missing_docs` is not enabled. The broad Clippy groups remain
deny-level, with lower group priority and explicit `allow` overrides for
`missing_errors_doc`, `missing_panics_doc`, and `missing_safety_doc`. These three rules are
inactive exceptions, not a warning tier; every active policy rule remains an error.
`missing_docs_in_private_items` and `undocumented_unsafe_blocks` are not enabled.
Workspace consumers must opt members into the installed tables with `[lints] workspace = true`.

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

| Area            | Policy                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------- |
| Shape           | 150-character lines, 75-line functions, max nesting depth 3, max 5 arguments                 |
| Safety          | `unsafe_code` is forbidden, `as` conversions are denied, wildcard enum match arms are denied |
| Error handling  | discarded `Result`s, `.ok()` error swallowing, `unwrap`, and `expect` are denied             |
| Debug artifacts | `dbg!`, stdout printing, stderr printing, and TODOs are denied                               |
| Maintainability | missing debug implementations, unused crates, and unnecessary mutability are denied          |
| Comments        | all Rust line and block comments are rejected by `cargo thx-lint check`                      |
| Structure       | optional legacy directory-depth Dylint source is shipped but not activated by the installer  |

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
