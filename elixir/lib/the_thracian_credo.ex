defmodule TheThracianCredo do
  @moduledoc """
  Credo plugin and shared configuration for The Thracian Elixir lint rules.

  Add `{TheThracianCredo, []}` to the `plugins:` list in `.credo.exs` to load
  the default rule set and custom checks from this package.
  """

  import Credo.Plugin

  @doc false
  def init(exec) do
    register_default_config(exec, default_config())
  end

  @doc """
  Returns the default Credo configuration registered by the plugin.
  """
  def default_config do
    """
    %{
      configs: [
        %{
          name: "default",
          plugins: [{TheThracianCredo, []}],
          files: %{
            included: ["lib/", "src/", "web/", "apps/", "test/"],
            excluded: [~r"/_build/", ~r"/deps/", ~r"/node_modules/"]
          },
          strict: true,
          parse_timeout: 5000,
          color: true,
          checks: %{extra: TheThracianCredo.checks()}
        }
      ]
    }
    """
  end

  @doc """
  Returns the checks installed into existing Credo configs.
  """
  def checks do
    [
      {Credo.Check.Readability.MaxLineLength, [max_length: 150, exit_status: 2, priority: :high]},
      {TheThracianCredo.Check.Refactor.FunctionBodyLength, [max_lines: 75, exit_status: 2, priority: :high]},
      {Credo.Check.Refactor.Nesting, [max_nesting: 3, exit_status: 2, priority: :high]},
      {Credo.Check.Refactor.FunctionArity, [max_arity: 5, exit_status: 2, priority: :high]},
      {Credo.Check.Refactor.CyclomaticComplexity, [max_complexity: 10, exit_status: 2, priority: :high]},
      {Credo.Check.Warning.IoInspect, [exit_status: 2, priority: :high]},
      {Credo.Check.Warning.IExPry, [exit_status: 2, priority: :high]},
      {Credo.Check.Refactor.VariableRebinding, [exit_status: 2, priority: :high]},
      {Credo.Check.Readability.Specs, [exit_status: 2, priority: :high]},
      {Credo.Check.Readability.ModuleDoc, [exit_status: 2, priority: :high]},
      {Credo.Check.Readability.AliasOrder, [exit_status: 2, priority: :high]},
      {Credo.Check.Readability.StrictModuleLayout, [exit_status: 2, priority: :high]},
      {TheThracianCredo.Check.Design.MaxDirectoryDepth, [max: 4, exit_status: 2, priority: :high]},
      {Credo.Check.Warning.UnusedEnumOperation, [exit_status: 2, priority: :high]},
      {Credo.Check.Warning.UnsafeExec, [exit_status: 2, priority: :high]}
    ]
  end

  @doc """
  Returns Dialyxir options that match The Thracian lint policy.
  """
  def dialyzer do
    [
      plt_add_apps: [:mix, :ex_unit],
      flags: [:unmatched_returns, :error_handling, :extra_return, :missing_return, :underspecs, :no_return],
      ignore_warnings: ".dialyzer_ignore.exs"
    ]
  end
end
