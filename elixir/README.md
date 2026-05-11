# @thethracian/elixir-lint-config

Versioned Elixir lint and Dialyxir config assets for `@thethracian/lint-cli`.

The package ships:

- `configs/credo.exs`
- `configs/credo_checks/function_body_length.ex`
- `configs/dialyzer_ignore.exs`
- `configs/mix_dialyzer_snippet.exs`

The Credo config fails on lines over 150 characters, functions over 75 lines, nesting deeper than 3 levels, more than 5 parameters, and cyclomatic complexity over 10.
