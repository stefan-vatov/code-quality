defmodule Mix.Tasks.ThxLint.Install do
  @moduledoc """
  Installs The Thracian Credo configuration into an Elixir project.
  """

  use Mix.Task

  @shortdoc "Installs The Thracian Credo configuration"
  @new_block "the_thracian_credo"
  @legacy_block "@thethracian/elixir-lint-config"
  @version Mix.Project.config()[:version]
  @formatter """
  [
    line_length: 150,
    trailing_comma: true,
    inputs: ["{mix,.formatter}.exs", "{config,lib,test}/**/*.{ex,exs}"]
  ]
  """
  @dialyzer_ignore "[]\n"
  @doctor """
  %Doctor.Config{
    ignore_modules: [],
    ignore_paths: [],
    min_module_doc_coverage: 40,
    min_module_spec_coverage: 0,
    min_overall_doc_coverage: 100,
    min_overall_moduledoc_coverage: 100,
    min_overall_spec_coverage: 100,
    exception_moduledoc_required: true,
    raise: false,
    reporter: Doctor.Reporters.Full,
    struct_type_spec_required: true,
    umbrella: false
  }
  """

  @impl true
  def run(args) do
    {opts, _argv, invalid} = OptionParser.parse(args, switches: [cwd: :string, force: :boolean, yes: :boolean])

    if invalid != [] do
      Mix.raise("Unknown option(s): #{inspect(invalid)}")
    end

    cwd = opts |> Keyword.get(:cwd, File.cwd!()) |> Path.expand()
    force? = Keyword.get(opts, :force, false)

    install_credo(cwd, force?)
    install_formatter(cwd, force?)
    write_managed_file(Path.join(cwd, ".dialyzer_ignore.exs"), @dialyzer_ignore, force?)
    write_managed_file(Path.join(cwd, ".doctor.exs"), @doctor, force?)

    Mix.shell().info("Installed The Thracian Elixir lint setup in #{cwd}")
  end

  defp install_credo(cwd, force?) do
    target = Path.join(cwd, ".credo.exs")
    body = TheThracianCredo.default_config()

    cond do
      force? or not File.exists?(target) ->
        write_managed_file(target, body, true)

      managed?(File.read!(target)) ->
        write_managed_file(target, body, false)

      true ->
        patch_existing_credo(target)
    end
  end

  defp install_formatter(cwd, force?) do
    target = Path.join(cwd, ".formatter.exs")

    cond do
      force? or not File.exists?(target) ->
        write_managed_file(target, @formatter, true)

      managed?(File.read!(target)) ->
        write_managed_file(target, @formatter, false)

      true ->
        File.write!(target, patch_formatter(File.read!(target)))
    end
  end

  defp write_managed_file(target, body, force?) do
    File.mkdir_p!(Path.dirname(target))
    block = managed_block(body)

    cond do
      not File.exists?(target) ->
        File.write!(target, block)

      managed?(File.read!(target)) ->
        File.write!(target, replace_managed_region(File.read!(target), block))

      force? ->
        File.write!(target, block)

      true ->
        Mix.shell().info("Skipping #{target}; existing file is not managed by #{@new_block}.")
    end
  end

  defp patch_existing_credo(target) do
    content = File.read!(target)

    target
    |> File.write!(content |> add_plugin() |> add_checks())
  end

  defp add_plugin(content) do
    cond do
      content =~ "{TheThracianCredo" ->
        content

      content =~ ~r/plugins:\s*\[\s*\]/ ->
        Regex.replace(~r/plugins:\s*\[\s*\]/, content, "plugins: [{TheThracianCredo, []}]", global: false)

      content =~ ~r/plugins:\s*\[/ ->
        Regex.replace(~r/plugins:\s*\[/, content, "plugins: [{TheThracianCredo, []}, ", global: false)

      true ->
        Mix.raise("Could not find a plugins: list in .credo.exs. Add {TheThracianCredo, []} manually.")
    end
  end

  defp add_checks(content) do
    cond do
      content =~ "TheThracianCredo.checks()" ->
        content

      content =~ ~r/enabled:\s*\[/ ->
        Regex.replace(~r/enabled:\s*\[/, content, "enabled: TheThracianCredo.checks() ++ [", global: false)

      content =~ ~r/extra:\s*\[/ ->
        Regex.replace(~r/extra:\s*\[/, content, "extra: TheThracianCredo.checks() ++ [", global: false)

      content =~ ~r/checks:\s*%\{\s*/ ->
        Regex.replace(~r/checks:\s*%\{\s*/, content, "checks: %{\n            extra: TheThracianCredo.checks(), ", global: false)

      true ->
        Mix.raise("Could not find a checks: map in .credo.exs. Add TheThracianCredo.checks() manually.")
    end
  end

  defp patch_formatter(content) do
    content
    |> add_formatter_option("line_length", "line_length: 150")
    |> add_formatter_option("trailing_comma", "trailing_comma: true")
  end

  defp add_formatter_option(content, key, line) do
    if content =~ "#{key}:" do
      content
    else
      Regex.replace(~r/^\s*\[/, content, "[\n  #{line},", global: false)
    end
  end

  defp managed?(content) do
    content =~ "# BEGIN #{@new_block}" or content =~ "# BEGIN #{@legacy_block}"
  end

  defp replace_managed_region(content, block) do
    content
    |> replace_region(@new_block, block)
    |> replace_region(@legacy_block, block)
  end

  defp replace_region(content, block_name, block) do
    pattern = ~r/# BEGIN #{Regex.escape(block_name)}[\s\S]*?# END #{Regex.escape(block_name)}/
    Regex.replace(pattern, content, String.trim_trailing(block), global: false)
  end

  defp managed_block(body) do
    """
    # BEGIN #{@new_block}
    # VERSION #{@version}
    #{String.trim(body)}
    # END #{@new_block}
    """
  end
end
