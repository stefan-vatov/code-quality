# @thethracian/rust-lint-config

Versioned Rust lint and format config assets for `@thethracian/lint-cli`.

The package ships:

- `configs/rustfmt.toml`
- `configs/clippy.toml`
- `configs/cargo-lints-package.toml`
- `configs/cargo-lints-workspace.toml`

The config sets rustfmt line width to 150 characters and denies Clippy functions over 75 lines, nesting deeper than 3 levels, functions with more than 5 arguments, debug artifacts (print_stdout, print_stderr, todo, dbg_macro), wildcard enum match arms, unsafe `as` casts (via pedantic lints), and unhandled `#[must_use]` values (unhandled Results and unawaited Futures).
