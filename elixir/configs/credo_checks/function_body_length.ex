defmodule TheThracian.Credo.Check.Refactor.FunctionBodyLength do
  use Credo.Check,
    category: :refactor,
    base_priority: :high,
    explanations: [
      check: "Functions should stay small enough to scan and review.",
      params: [
        max_lines: "The maximum number of lines allowed in a function definition."
      ]
    ],
    param_defaults: [max_lines: 75]

  alias Credo.IssueMeta
  alias Credo.SourceFile

  @definition_kinds [:def, :defp, :defmacro, :defmacrop]

  @impl true
  def run(source_file, params \\ []) do
    issue_meta = IssueMeta.for(source_file, params)
    max_lines = Keyword.get(params, :max_lines, 75)

    with {:ok, ast} <- Code.string_to_quoted(SourceFile.source(source_file), token_metadata: true) do
      {_ast, issues} = Macro.prewalk(ast, [], &traverse(&1, &2, issue_meta, max_lines))
      Enum.reverse(issues)
    else
      _error -> []
    end
  end

  defp traverse({kind, meta, [_head | _rest]} = ast, issues, issue_meta, max_lines)
       when kind in @definition_kinds do
    line_count = line_count(meta)

    if line_count > max_lines do
      {ast, [issue_for(issue_meta, ast, line_count, max_lines) | issues]}
    else
      {ast, issues}
    end
  end

  defp traverse(ast, issues, _issue_meta, _max_lines) do
    {ast, issues}
  end

  defp line_count(meta) do
    start_line = Keyword.get(meta, :line, 1)
    end_line = line_from(meta, :end) || line_from(meta, :end_of_expression) || start_line

    end_line - start_line + 1
  end

  defp line_from(meta, key) do
    meta
    |> Keyword.get(key, [])
    |> Keyword.get(:line)
  end

  defp issue_for(issue_meta, ast, line_count, max_lines) do
    format_issue(
      issue_meta,
      line_no: line_no(ast),
      trigger: function_name(ast),
      message: "Function is too long (#{line_count} lines, max #{max_lines})."
    )
  end

  defp line_no({_kind, meta, _args}) do
    Keyword.get(meta, :line, 1)
  end

  defp function_name({_kind, _meta, [head | _rest]}) do
    head
    |> function_head()
    |> format_function_name()
  end

  defp function_head({:when, _meta, [head | _guards]}), do: head
  defp function_head(head), do: head

  defp format_function_name({name, _meta, nil}) when is_atom(name), do: "#{name}/0"
  defp format_function_name({name, _meta, args}) when is_atom(name), do: "#{name}/#{length(args)}"
  defp format_function_name(_head), do: "function"
end
