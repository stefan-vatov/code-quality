defmodule TheThracianCredo.Check.Readability.NoComments do
  @moduledoc """
  Rejects lexical comments, including Credo suppression directives.
  A first-line interpreter shebang at column one is allowed.

  Uses the Elixir parser so literal hashes and documentation attributes remain
  valid while comments inside interpolation are reported. Invalid syntax is
  handled by Credo's parser diagnostics.
  """

  use Credo.Check,
    category: :readability,
    base_priority: :high,
    explanations: [check: "Lexical comments are forbidden; use documentation attributes for API documentation."]

  alias Credo.IssueMeta
  alias Credo.SourceFile

  @impl true
  @spec run(SourceFile.t(), Keyword.t()) :: [Credo.Issue.t()]
  def run(source_file, params \\ []) do
    issue_meta = IssueMeta.for(source_file, params)

    case Code.string_to_quoted_with_comments(SourceFile.source(source_file), emit_warnings: false) do
      {:ok, _ast, comments} ->
        comments
        |> Enum.reject(&interpreter_shebang?/1)
        |> Enum.map(fn comment ->
          format_issue(issue_meta,
            line_no: comment.line,
            column: comment.column,
            trigger: comment.text,
            message: "Lexical comments are forbidden."
          )
        end)

      {:error, _error} ->
        []
    end
  end

  defp interpreter_shebang?(%{line: 1, column: 1, text: text}) do
    Regex.match?(~r/\A\#![\t ]*\/[^\s]+/, text)
  end

  defp interpreter_shebang?(_comment), do: false
end
