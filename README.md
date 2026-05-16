# The Thracian Code Quality

Nx workspace for The Thracian code-quality packages.

## Packages

- `@thethracian/oxlint-config`: npm package imported directly by TypeScript/Oxlint projects.
- `cargo-thx-lint`: crates.io Cargo subcommand that installs Rust `rustfmt`, Clippy, and Cargo lint config.
- `the_thracian_credo`: Hex package that provides the Credo plugin, custom checks, and Mix installer for Elixir projects.

Rust and Elixir are native ecosystem packages. They are not npm wrappers.

## Commands

```sh
pnpm install
pnpm run check
pnpm run build
pnpm run test:projects
pnpm nx run-many -t pack
```
