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

    assert_success(mix(project, ["deps.get"]))
    assert_success(mix(project, ["thx_lint.install", "--yes"]))

    {output, status} = mix(project, ["credo", "--strict"])

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

    assert_success(mix(project, ["deps.get"]))
    assert_success(mix(project, ["thx_lint.install", "--yes"]))

    {output, status} = mix(project, ["credo", "--strict"])

    assert status != 0
    assert output =~ "File is nested"
  end

  for existing? <- [false, true] do
    @tag timeout: 120_000
    test "comment policy survives suppression in installed config, existing: #{existing?}" do
      project = temp_project("comments")
      File.mkdir_p!(Path.join(project, "lib"))
      File.write!(Path.join(project, "mix.exs"), consumer_mix_project())

      if unquote(existing?) do
        File.write!(Path.join(project, ".credo.exs"), existing_credo_config())
      end

      assert_success(mix(project, ["deps.get"]))
      assert_success(mix(project, ["thx_lint.install", "--yes"]))

      source = """
      defmodule Consumer do
        @moduledoc "# documentation is allowed"
        @doc "# documentation is allowed"
        @spec value() :: String.t()
        def value, do: "# literal"
      end
      """

      file = Path.join(project, "lib/consumer.ex")
      File.write!(file, source)
      assert_success(mix(project, ["credo", "--strict"]))
      File.write!(file, "#!/usr/bin/env elixir\n" <> source)
      assert_success(mix(project, ["credo", "--strict"]))

      for prefix <- [
            "# ordinary\n",
            "\n#!/usr/bin/env elixir\n",
            "# credo:disable-for-this-file\n",
            "# credo:disable-for-this-file TheThracianCredo.Check.Readability.NoComments\n",
            "# credo:disable-for-lines:100\n",
            "# credo:disable-for-next-line\n# credo:disable-for-previous-line\n"
          ] do
        File.write!(file, prefix <> source)
        {output, status} = mix(project, ["credo", "--strict"])
        assert status != 0, output
        assert output =~ "Lexical comments are forbidden", output
      end
    end
  end

  defp mix(project, args) do
    System.cmd("mise", ["exec", "--", "mix" | args], cd: project, stderr_to_stdout: true)
  end

  defp temp_project(name) do
    path = Path.expand("../.consumer-tests/#{name}-#{System.unique_integer([:positive])}", __DIR__)
    File.rm_rf!(path)
    File.mkdir_p!(path)
    on_exit(fn -> File.rm_rf!(path) end)
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
