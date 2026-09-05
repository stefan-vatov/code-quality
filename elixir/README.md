# the_thracian_credo

<p align="center">
  <a href="https://hex.pm/packages/the_thracian_credo"><img alt="Hex.pm version" src="https://img.shields.io/hexpm/v/the_thracian_credo?style=flat-square"></a>
  <a href="https://hex.pm/packages/the_thracian_credo"><img alt="Hex.pm downloads" src="https://img.shields.io/hexpm/dt/the_thracian_credo?style=flat-square"></a>
  <a href="https://github.com/stefan-vatov/code-quality/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/stefan-vatov/code-quality/ci.yml?branch=main&style=flat-square"></a>
  <a href="https://github.com/stefan-vatov/code-quality/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
</p>

`the_thracian_credo` is a Credo plugin and installer for experimental, painfully strict, very opinionated Elixir linting.

```text
mix thx_lint.install --yes
  patches .credo.exs
  writes formatter and Doctor config
  prepares Dialyxir ignore config
  enables The Thracian custom Credo checks
```

## Why Use It

- Credo plugin first: consumers depend on a package instead of copying custom checks into their app.
- Strict defaults: line length, function size, nesting, arity, complexity, debug artifacts, specs, docs, rebinding, and unsafe exec calls are enforced.
- Installer included: fresh projects get a managed config; existing projects are patched carefully.
- Dialyzer-friendly: `TheThracianCredo.dialyzer()` returns the matching Dialyxir options.
- Built for agentic code review: it rejects patterns that hide intent, swallow errors, or waste review context.

## Install

Add the package to `mix.exs`:

```elixir
defp deps do
  [
    {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
    {:the_thracian_credo, "~> 0.1.0", only: [:dev, :test], runtime: false}
  ]
end
```

Install and run:

```sh
mix deps.get
mix thx_lint.install --yes
mix credo --strict
```

## Existing Projects

Fresh projects receive a managed `.credo.exs` with the plugin enabled:

```elixir
plugins: [{TheThracianCredo, []}]
```

Existing `.credo.exs` files are patched in place when the installer can do so safely. Managed regions include a version marker:

```elixir
# BEGIN the_thracian_credo
# VERSION 0.1.0
# END the_thracian_credo
```

Legacy regions from `@thethracian/elixir-lint-config` are migrated automatically.

## Dialyxir

If the project uses Dialyxir, add this to `project/0`:

```elixir
dialyzer: TheThracianCredo.dialyzer()
```

## What It Enforces

| Area              | Policy                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------- |
| Shape             | 150-character lines, 75-line function bodies, max nesting depth 3, max function arity 5 |
| Complexity        | cyclomatic complexity over 10 fails the Credo run                                       |
| Debug artifacts   | `IO.inspect`, `IEx.pry`, and similar review-time leftovers are rejected                 |
| Contracts         | public functions require specs and modules require docs                                 |
| State clarity     | variable rebinding is rejected so data flow stays explicit                              |
| Project structure | source files nested more than 4 directories under the Mix project root are rejected     |
| Safety            | unsafe command execution and unused enum operations are flagged                         |
| Comments          | lexical `#` comments fail; only a first-line interpreter shebang is allowed             |

### No lexical comments

`TheThracianCredo.Check.Readability.NoComments` is enabled by default at high priority
with exit status 2. The installer activates it in both fresh and existing configurations
through `TheThracianCredo.checks()`; existing consumers receive it when updating the package.

The check uses Elixir's [`Code.string_to_quoted_with_comments/2`](https://hexdocs.pm/elixir/1.18.4/Code.html#string_to_quoted_with_comments/2).
It rejects standalone, trailing, empty, and interpolation comments. Literal `#` characters
inside strings, sigils, charlists, quoted atoms, and heredocs are allowed. `@doc` and
`@moduledoc` attributes are code, not lexical comments, and remain allowed and required
where the existing documentation checks apply.

For parity with the TypeScript and Rust policy, an interpreter shebang such as
`#!/usr/bin/env elixir` is allowed only at the very start of the file (line 1, column 1),
with an absolute interpreter path after `#!` and optional spaces or tabs. Later or indented
`#!` comments and `#!` without an interpreter path remain forbidden. Invalid syntax remains
the responsibility of Credo's parser diagnostics.

The plugin clears Credo's [inline suppression directives](https://hexdocs.pm/credo/config_comments.html)
before analysis in the suggest, list, and diff commands. A directive cannot suppress this
check or hide another check's findings. Configuration-file check selections still apply.
The policy covers files selected for analysis; installer ownership markers in generated
configuration files are not exemptions and will fail if those files are explicitly included.

Credo's [official check catalog](https://hexdocs.pm/credo/api-reference.html) has no general
all-comments prohibition, so this check ships with the package as a custom check.

## Local Development

Use a local checkout when changing the package itself:

```elixir
defp deps do
  [
    {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
    {:the_thracian_credo, path: "/path/to/linters/elixir", only: [:dev, :test], runtime: false}
  ]
end
```

Then run:

```sh
mix deps.get
mix thx_lint.install --yes
mix credo --strict
```

## Registry Links

- Hex.pm: <https://hex.pm/packages/the_thracian_credo>
- Source: <https://github.com/stefan-vatov/code-quality/tree/main/elixir>
- Issues: <https://github.com/stefan-vatov/code-quality/issues>

## License

MIT. See [LICENSE](LICENSE).
