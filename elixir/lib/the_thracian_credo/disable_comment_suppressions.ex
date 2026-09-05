defmodule TheThracianCredo.DisableCommentSuppressions do
  @moduledoc """
  Clears inline suppression directives after Credo prepares its checks.

  Comment directives cannot disable the comment ban or conceal other issues.
  Configuration-file check selections are unaffected.
  """

  use Credo.Execution.Task

  @impl true
  @spec call(Credo.Execution.t(), Keyword.t()) :: Credo.Execution.t()
  def call(exec, _opts) do
    %{exec | config_comment_map: %{}}
  end
end
