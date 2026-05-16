defmodule TheThracianCredo.Check.Design.MaxDirectoryDepth do
  @moduledoc """
  Credo check that limits source file directory depth from the Mix project root.
  """

  use Credo.Check,
    base_priority: :high,
    category: :design,
    param_defaults: [max: 4],
    explanations: [
      check: "Source files must not be nested deeper than the configured maximum directory depth.",
      params: [
        max: "Maximum allowed directory depth."
      ]
    ]

  alias Credo.Check.Params
  alias Credo.IssueMeta

  @impl true
  def run(source_file, params \\ []) do
    max = Params.get(params, :max, __MODULE__)
    issue_meta = IssueMeta.for(source_file, params)
    depth = source_file.filename |> Path.dirname() |> count_depth(source_file.filename)

    if depth > max do
      [
        format_issue(issue_meta,
          message: "File is nested #{depth} levels deep. Maximum allowed depth is #{max}.",
          trigger: String.replace(source_file.filename, File.cwd!(), "")
        )
      ]
    else
      []
    end
  end

  defp count_depth(dir, full_path) do
    root = determine_root(full_path)

    dir
    |> String.replace_prefix(root, "")
    |> String.trim_leading("/")
    |> String.split("/")
    |> Enum.reject(&(&1 == ""))
    |> length()
  end

  defp determine_root(path) do
    path
    |> Path.dirname()
    |> find_mix_root(10)
  end

  defp find_mix_root(dir, 0), do: dir

  defp find_mix_root(dir, attempts) do
    if File.exists?(Path.join(dir, "mix.exs")) do
      dir
    else
      find_parent_mix_root(dir, attempts)
    end
  end

  defp find_parent_mix_root(dir, attempts) do
    parent = Path.dirname(dir)

    if parent == dir do
      File.cwd!()
    else
      find_mix_root(parent, attempts - 1)
    end
  end
end
