defmodule TheThracianCredo.ConsumerActivationTest do
  use ExUnit.Case, async: false

  @tag timeout: 120_000
  test "installed package config makes Credo enforce package checks" do
    project = temp_project("consumer")
    File.mkdir_p!(Path.join(project, "lib/deeply/nested/module/tree"))
    File.write!(Path.join(project, "mix.exs"), consumer_mix_project())

    File.write!(
      Path.join(project, "lib/deeply/nested/module/tree/no_docs.ex"),
      Enum.join(
        [
          "defmodule Consumer.Deeply.Nested.Module.Tree.NoDocs do",
          "  def very_long do",
          "    :line_1",
          "    :line_2",
          "    :line_3",
          "    :line_4",
          "    :line_5",
          "    :line_6",
          "  end",
          "end",
          ""
        ],
        "\n"
      )
    )

    assert_success(System.cmd("mix", ["deps.get"], cd: project, stderr_to_stdout: true))
    assert_success(System.cmd("mix", ["thx_lint.install", "--yes"], cd: project, stderr_to_stdout: true))

    {output, status} = System.cmd("mix", ["credo", "--strict"], cd: project, stderr_to_stdout: true)

    assert status != 0
    assert output =~ "File is nested"
  end

  @tag timeout: 120_000
  test "installer makes package checks active in existing Credo configs" do
    project = temp_project("existing-consumer")
    File.mkdir_p!(Path.join(project, "lib/deeply/nested/module/tree"))
    File.write!(Path.join(project, "mix.exs"), consumer_mix_project())
    File.write!(Path.join(project, ".credo.exs"), existing_credo_config())

    File.write!(
      Path.join(project, "lib/deeply/nested/module/tree/bad.ex"),
      """
      defmodule Consumer.Deeply.Nested.Module.Tree.Bad do
        def ok, do: :ok
      end
      """
    )

    assert_success(System.cmd("mix", ["deps.get"], cd: project, stderr_to_stdout: true))
    assert_success(System.cmd("mix", ["thx_lint.install", "--yes"], cd: project, stderr_to_stdout: true))

    {output, status} = System.cmd("mix", ["credo", "--strict"], cd: project, stderr_to_stdout: true)

    assert status != 0
    assert output =~ "File is nested"
  end

  defp temp_project(name) do
    path = Path.join(System.tmp_dir!(), "the-thracian-credo-activation-#{name}-#{System.unique_integer([:positive])}")
    File.rm_rf!(path)
    File.mkdir_p!(path)
    path
  end

  defp consumer_mix_project do
    package_path = Path.expand("..", __DIR__)

    """
    defmodule Consumer.MixProject do
      use Mix.Project

      def project do
        [
          app: :consumer,
          version: "0.1.0",
          elixir: "~> 1.15",
          deps: deps()
        ]
      end

      defp deps do
        [
          {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
          {:the_thracian_credo, path: #{inspect(package_path)}, only: [:dev, :test], runtime: false}
        ]
      end
    end
    """
  end

  defp existing_credo_config do
    """
    %{
      configs: [
        %{
          name: "default",
          files: %{included: ["lib/"], excluded: [~r"/_build/", ~r"/deps/"]},
          plugins: [],
          strict: true,
          checks: %{enabled: [{Credo.Check.Warning.IoInspect, []}], disabled: []}
        }
      ]
    }
    """
  end

  defp assert_success({output, 0}), do: output
  defp assert_success({output, status}), do: flunk("expected command to pass with status #{status}\n#{output}")
end
