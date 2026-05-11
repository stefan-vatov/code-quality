# The Thracian Linters

Nx monorepo for The Thracian lint configuration packages.

## Packages

- `@thethracian/oxlint-config`: importable Oxlint config for TypeScript projects.
- `@thethracian/rust-lint-config`: versioned Rust lint and format config assets.
- `@thethracian/elixir-lint-config`: versioned Elixir Credo and Dialyxir config assets.
- `@thethracian/lint-cli`: patcher CLI for ecosystems without first-party shared config support.

## Commands

```sh
pnpm install
pnpm check
pnpm build
pnpm nx affected -t check
pnpm release:dry-run
```
