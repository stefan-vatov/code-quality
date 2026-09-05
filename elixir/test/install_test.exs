defmodule TheThracianCredo.InstallTest do
  use ExUnit.Case, async: false

  alias Mix.Tasks.ThxLint.Install

  @new_marker "# BEGIN the_thracian_credo"
  @old_marker "# BEGIN @thethracian/elixir-lint-config"

  test "writes managed Credo and formatter setup for fresh projects" do
    project = temp_project("fresh")
    File.write!(Path.join(project, "mix.exs"), minimal_mix_project())

    Install.run(["--cwd", project, "--yes"])

    credo = File.read!(Path.join(project, ".credo.exs"))
    formatter = File.read!(Path.join(project, ".formatter.exs"))

    assert credo =~ @new_marker
    assert credo =~ "# VERSION #{Mix.Project.config()[:version]}"
    assert credo =~ "{TheThracianCredo, []}"
    assert formatter =~ @new_marker
    assert formatter =~ "line_length: 150"
    assert formatter =~ "trailing_comma: true"
  end

  test "reruns replace owned regions without duplication" do
    project = temp_project("rerun")
    File.write!(Path.join(project, "mix.exs"), minimal_mix_project())

    File.write!(
      Path.join(project, ".credo.exs"),
      Enum.join(
        [
          @new_marker,
          "# VERSION 0.0.1",
          "%{configs: []}",
          "# END the_thracian_credo",
          ""
        ],
        "\n"
      )
    )

    Install.run(["--cwd", project, "--yes"])
    Install.run(["--cwd", project, "--yes"])

    credo = File.read!(Path.join(project, ".credo.exs"))

    assert count(credo, @new_marker) == 1
    refute credo =~ "0.0.1"
    assert credo =~ "# VERSION #{Mix.Project.config()[:version]}"
  end

  test "migrates legacy npm owned regions" do
    project = temp_project("legacy")
    File.write!(Path.join(project, "mix.exs"), minimal_mix_project())

    File.write!(
      Path.join(project, ".credo.exs"),
      Enum.join(
        [
          @old_marker,
          "# VERSION 0.0.0",
          "%{configs: []}",
          "# END @thethracian/elixir-lint-config",
          ""
        ],
        "\n"
      )
    )

    Install.run(["--cwd", project, "--yes"])

    credo = File.read!(Path.join(project, ".credo.exs"))

    assert credo =~ @new_marker
    refute credo =~ @old_marker
    assert count(credo, @new_marker) == 1
  end

  test "patches an existing Credo plugin list without dropping local config" do
    project = temp_project("existing")
    File.write!(Path.join(project, "mix.exs"), minimal_mix_project())

    File.write!(
      Path.join(project, ".credo.exs"),
      """
      %{
        configs: [
          %{
            name: "default",
            plugins: [],
            strict: true,
            checks: %{enabled: [{Credo.Check.Warning.IoInspect, []}], disabled: []}
          }
        ]
      }
      """
    )

    Install.run(["--cwd", project, "--yes"])

    credo = File.read!(Path.join(project, ".credo.exs"))

    assert credo =~ "{TheThracianCredo, []}"
    assert credo =~ "{Credo.Check.Warning.IoInspect, []}"
    assert Code.eval_string(credo) |> elem(0) |> is_map()
  end

  test "rejects unknown options" do
    project = temp_project("unknown")
    assert_raise Mix.Error, ~r/Unknown option/, fn -> Install.run(["--cwd", project, "--unknown"]) end
    refute File.exists?(Path.join(project, ".credo.exs"))
  end

  test "patches formatter options without replacing existing choices" do
    project = temp_project("formatter")
    target = Path.join(project, ".formatter.exs")
    File.write!(target, "[inputs: [\"lib/*.ex\"]]")
    Install.run(["--cwd", project])
    {options, _} = target |> File.read!() |> Code.eval_string()
    assert options[:inputs] == ["lib/*.ex"]
    assert options[:line_length] == 150
    assert options[:trailing_comma]
    File.write!(target, "[line_length: 100, trailing_comma: false]")
    Install.run(["--cwd", project])
    assert File.read!(target) == "[line_length: 100, trailing_comma: false]"
  end

  test "preserves unmanaged auxiliary files unless force is requested" do
    project = temp_project("force")
    target = Path.join(project, ".dialyzer_ignore.exs")
    File.write!(target, "[:existing]")
    Install.run(["--cwd", project])
    assert File.read!(target) == "[:existing]"
    Install.run(["--cwd", project, "--force"])
    assert {[], _} = target |> File.read!() |> Code.eval_string()
  end

  test "patches extra and empty check maps while preserving other plugins and remaining idempotent" do
    for checks <- ["%{extra: []}", "%{disabled: []}"] do
      project = temp_project("check-maps")
      target = Path.join(project, ".credo.exs")
      File.write!(target, "%{configs: [%{plugins: [{OtherPlugin, []}], checks: #{checks}}]}")
      Install.run(["--cwd", project])
      first = File.read!(target)
      Install.run(["--cwd", project])
      assert File.read!(target) == first
      {config, _} = Code.eval_string(first)
      assert hd(config.configs).plugins == [{TheThracianCredo, []}, {OtherPlugin, []}]
      assert hd(config.configs).checks.extra == TheThracianCredo.checks()
    end
  end

  test "reports unpatchable configs without overwriting them" do
    for {config, message} <- [
          {"%{configs: []}", ~r/Could not find a plugins/},
          {"%{plugins: []}", ~r/Could not find a checks/}
        ] do
      project = temp_project("invalid")
      target = Path.join(project, ".credo.exs")
      File.write!(target, config)
      assert_raise Mix.Error, message, fn -> Install.run(["--cwd", project]) end
      assert File.read!(target) == config
    end
  end

  defp temp_project(name) do
    path = Path.expand("../.consumer-tests/install-#{name}-#{System.unique_integer([:positive])}", __DIR__)
    File.rm_rf!(path)
    File.mkdir_p!(path)
    on_exit(fn -> File.rm_rf!(path) end)
    path
  end

  defp minimal_mix_project do
    """
    defmodule Consumer.MixProject do
      use Mix.Project

      def project do
        [app: :consumer, version: "0.1.0", elixir: "~> 1.15", deps: []]
      end
    end
    """
  end

  defp count(value, pattern) do
    value
    |> String.split(pattern)
    |> length()
    |> Kernel.-(1)
  end
end
