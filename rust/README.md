# @thethracian/rust-lint-config

Versioned Rust lint and format config assets for `@thethracian/lint-cli`.

The package ships:

- `configs/rustfmt.toml`
- `configs/clippy.toml`
- `configs/cargo-lints-package.toml`
- `configs/cargo-lints-workspace.toml`

The config sets rustfmt line width to 150 characters and denies Clippy functions over 75 lines, nesting deeper than 3 levels, functions with more than 5 arguments, debug artifacts (print_stdout, print_stderr, todo, dbg_macro), wildcard enum match arms, unsafe `as` casts (via pedantic lints), and unhandled `#[must_use]` values (unhandled Results and unawaited Futures). The `pedantic` group forces strictly idiomatic, highly structured implementations. Error handling is strictly enforced: `unwrap_used`, `expect_used`, and `unused_result_ok` are all denied — no panic shortcuts or discarded errors. Rustc lints deny `unsafe_code`, `unused_must_use`, `unused_mut`, `missing_docs`, `missing_debug_implementations`, and `non_exhaustive_omitted_patterns`, and warn on `unused_crate_dependencies` to prevent hallucinated imports. Test code is exempted from unwrap/expect/panic denials via clippy.toml (`allow-unwrap-in-tests`, `allow-expect-in-tests`, `allow-panic-in-tests`). Immutability is enforced by Rust's `let` vs `let mut` design: `unused_mut` denies unnecessary `mut`, and the `pedantic` Clippy group catches redundant mutable bindings (`unnecessary_mut_passed`, `mut_mut`).
