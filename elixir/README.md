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
