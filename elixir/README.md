# the_thracian_credo

Hex package for The Thracian Elixir lint rules.

It provides:

- `TheThracianCredo`, a Credo plugin that registers the default config.
- `TheThracianCredo.Check.Refactor.FunctionBodyLength`.
- `TheThracianCredo.Check.Design.MaxDirectoryDepth`.
- `mix thx_lint.install`, an installer for local `.credo.exs`, `.formatter.exs`, `.doctor.exs`, and `.dialyzer_ignore.exs` setup.

## Install

After publishing, add the dependency:

```elixir
defp deps do
  [
    {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
    {:the_thracian_credo, "~> 0.1", only: [:dev, :test], runtime: false}
  ]
end
```

For local validation before publishing:

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

## Existing Projects

For a fresh project, the installer writes a managed `.credo.exs` that enables the plugin:

```elixir
plugins: [{TheThracianCredo, []}]
```

For an existing `.credo.exs`, it preserves local config and adds the plugin entry to the existing `plugins:` list. Managed files use versioned comments:

```elixir
# BEGIN the_thracian_credo
# VERSION 0.1.0
# END the_thracian_credo
```

Legacy npm markers from `@thethracian/elixir-lint-config` are migrated automatically.

## Dialyxir

If the project uses Dialyxir, add this to `project/0`:

```elixir
dialyzer: TheThracianCredo.dialyzer()
```

## Rules

Credo fails on lines over 150 characters, functions over 75 lines, nesting deeper than 3 levels, more than 5 parameters, cyclomatic complexity over 10, debug artifacts, variable rebinding, missing public specs, missing module docs, unsafe exec calls, unused enum operations, and source files nested more than 4 directories below the Mix project root.
