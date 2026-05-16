# cargo-thx-lint

Cargo subcommand that installs The Thracian Rust lint configuration into a Rust package or workspace.

## Install

After publishing:

```sh
cargo install cargo-thx-lint
cargo thx-lint init --write
```

For local validation before publishing:

```sh
cargo install --path /path/to/linters/rust --force
cargo thx-lint init --write --cwd /path/to/consumer
```

## Update

```sh
cargo install cargo-thx-lint --force
cargo thx-lint update --write
```

Reruns are idempotent. Files and Cargo manifest regions owned by this package are replaced in place, not duplicated.

## Managed Files

The installer writes:

- `rustfmt.toml`
- `clippy.toml`
- a managed lint section in `Cargo.toml`
- `.thethracian-checks/depth`, the vendored Dylint custom check source

Managed regions use versioned comments:

```toml
# BEGIN cargo-thx-lint
# VERSION 0.1.0
# END cargo-thx-lint
```

Legacy npm markers from `@thethracian/rust-lint-config` are migrated automatically on update.

## Verify

```sh
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
```

The config sets rustfmt line width to 150 characters and denies Clippy functions over 75 lines, nesting deeper than 3 levels, functions with more than 5 arguments, debug artifacts, wildcard enum match arms, unsafe `as` casts, discarded results, `unwrap`, and `expect`. Rustc lints deny unsafe code, unused must-use values, unnecessary mutability, missing docs, missing debug implementations, and unused crate dependencies.
