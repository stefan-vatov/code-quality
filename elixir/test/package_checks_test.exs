defmodule TheThracianCredo.PackageChecksTest do
  use ExUnit.Case, async: false

  import ExUnit.CaptureIO

  alias Credo.SourceFile
  alias Credo.Test.CheckRunner
  alias Mix.Tasks.ThxLint.Install
  alias TheThracianCredo.Check.Design.MaxDirectoryDepth
  alias TheThracianCredo.Check.Refactor.FunctionBodyLength

  setup do
    {:ok, _apps} = Application.ensure_all_started(:credo)
    project = Path.expand("../.consumer-tests/in-process-#{System.unique_integer([:positive])}", __DIR__)
    File.mkdir_p!(Path.join(project, "lib"))
    File.write!(Path.join(project, "mix.exs"), "[]")
    on_exit(fn -> File.rm_rf!(project) end)
    {:ok, project: project}
  end

  test "installed plugin enforces comments in process without honoring suppressions", %{project: project} do
    Install.run(["--cwd", project, "--yes"])
    File.write!(Path.join(project, "lib/example.ex"), "# credo:disable-for-this-file\n:ok\n")

    for command <- ["suggest", "list"] do
      capture_io(fn ->
        File.cd!(project, fn ->
          exec = Credo.run([command, "--strict"])
          assert exec.config_comment_map == %{}
          assert Enum.any?(Credo.Execution.get_issues(exec), &(&1.check == TheThracianCredo.Check.Readability.NoComments))
        end)
      end)
    end
  end

  test "directory depth permits boundary and reports excess depth", %{project: project} do
    shallow = SourceFile.parse(":ok", Path.join(project, "lib/example.ex"))
    deep = SourceFile.parse(":ok", Path.join(project, "lib/one/two/example.ex"))

    assert CheckRunner.run_check(shallow, MaxDirectoryDepth, max: 1) == []
    assert [issue] = CheckRunner.run_check(deep, MaxDirectoryDepth, max: 2)
    assert issue.message == "File is nested 3 levels deep. Maximum allowed depth is 2."
  end

  test "directory root discovery terminates without a nearby project" do
    root_file = SourceFile.parse(":ok", "/example.ex")
    distant_file = SourceFile.parse(":ok", "/one/two/three/four/five/six/seven/eight/nine/ten/eleven/example.ex")
    assert CheckRunner.run_check(root_file, MaxDirectoryDepth) == []
    assert [issue] = CheckRunner.run_check(distant_file, MaxDirectoryDepth)
    assert issue.message =~ "File is nested"
  end

  test "function length reports guarded functions and macros while accepting the boundary" do
    source = """
    defmodule Example do
      def zero do
        :ok
      end
      def guarded(value) when is_atom(value) do
        value
      end
      defmacro macro_value() do
        :ok
      end
      def short, do: :ok
    end
    """

    file = SourceFile.parse(source, "lib/example.ex")
    assert CheckRunner.run_check(file, FunctionBodyLength, max_lines: 3) == []
    issues = CheckRunner.run_check(file, FunctionBodyLength, max_lines: 2)
    assert Enum.map(issues, & &1.trigger) == ["zero/0", "guarded/1", "macro_value/0"]
    assert Enum.all?(issues, &(&1.message == "Function is too long (3 lines, max 2)."))
  end

  test "function check tolerates invalid syntax and one-line definitions" do
    invalid = SourceFile.parse("defmodule Broken do", "lib/broken.ex")
    short = SourceFile.parse("def short, do: :ok", "lib/short.ex")
    assert FunctionBodyLength.run(invalid) == []
    assert [issue] = FunctionBodyLength.run(short, max_lines: 0)
    assert issue.trigger == "short/0"
  end

  test "Dialyxir settings retain strict return and error handling checks" do
    options = TheThracianCredo.dialyzer()
    assert options[:plt_add_apps] == [:mix, :ex_unit]
    assert options[:ignore_warnings] == ".dialyzer_ignore.exs"

    assert options[:flags] == [
             :unmatched_returns,
             :error_handling,
             :extra_return,
             :missing_return,
             :underspecs,
             :no_return
           ]
  end
end
