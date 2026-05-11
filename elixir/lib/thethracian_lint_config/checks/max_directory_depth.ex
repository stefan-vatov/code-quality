defmodule ThethracianLintConfig.Checks.MaxDirectoryDepth do
  @moduledoc """
  Checks that source files are not nested beyond a configurable directory depth.

  Deep directory structures make code harder to navigate and trace dependencies.
  Prefer feature-based flat folders over layered deep hierarchies.

  ## Configuration

      {ThethracianLintConfig.Checks.MaxDirectoryDepth, [max: 4]}

  ## Examples

      # BAD: src/features/auth/domain/models/user.ex (5 levels)
      # GOOD: src/auth/user.ex (2 levels)
  """

  use Credo.Check,
    base_priority: :high,
    category: :design,
    param_defaults: [max: 4],
    explanations: [
      check: """
      Source files must not be nested deeper than the configured maximum directory depth.

      Deep hierarchies become difficult to navigate and reason about.
      AI agents struggle to trace dependencies through deep nesting.
      Each directory level adds cognitive overhead for both humans and agents.
      """,
      params: [
        max: "Maximum allowed directory depth (default: 4)"
      ]
    ]

  @impl true
  def run(source_file, params \\ []) do
    max = Params.get(params, :max, __MODULE__)
    issue_meta = IssueMeta.for(source_file, params)

    depth = count_depth(source_file.filename, source_file.filename |> Path.dirname())

    if depth > max do
      [
        format_issue(issue_meta,
          message:
            "File is nested #{depth} levels deep. Maximum allowed depth is #{max}. " <>
              "Use a flatter directory structure (e.g., feature-based flat folders).",
          trigger: String.replace(source_file.filename, File.cwd!(), "")
        )
      ]
    else
      []
    end
  end

  defp count_depth(full_path, dir) do
    root = determine_root(full_path)

    dir
    |> String.replace_prefix(root, "")
    |> String.trim_leading("/")
    |> String.split("/")
    |> Enum.reject(&(&1 == ""))
    |> length()
  end

  defp determine_root(path) do
    # Walk up until we find mix.exs — that's the project root
    path
    |> Path.dirname()
    |> find_mix_root(10)
  end

  defp find_mix_root(dir, 0), do: dir

  defp find_mix_root(dir, attempts) do
    if File.exists?(Path.join(dir, "mix.exs")) do
      dir
    else
      parent = Path.dirname(dir)

      if parent == dir do
        # Reached filesystem root, use working directory
        File.cwd!()
      else
        find_mix_root(parent, attempts - 1)
      end
    end
  end
end
