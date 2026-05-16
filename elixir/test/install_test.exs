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
    assert credo =~ "# VERSION 0.1.0"
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
    assert credo =~ "# VERSION 0.1.0"
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

  defp temp_project(name) do
    path = Path.join(System.tmp_dir!(), "the-thracian-credo-#{name}-#{System.unique_integer([:positive])}")
    File.rm_rf!(path)
    File.mkdir_p!(path)
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
