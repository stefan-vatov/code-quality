defmodule TheThracianCredo.NoCommentsTest do
  use ExUnit.Case, async: true

  alias Credo.SourceFile
  alias TheThracianCredo.Check.Readability.NoComments

  setup_all do
    {:ok, _apps} = Application.ensure_all_started(:credo)
    :ok
  end

  test "reports standalone, trailing, empty and suppression comments at parser locations" do
    source = "# ordinary\n:ok # trailing\n#\n# credo:disable-for-this-file\n"
    issues = check(source)

    assert Enum.map(issues, &{&1.line_no, &1.column}) == [{1, 1}, {2, 5}, {3, 1}, {4, 1}]
    assert Enum.all?(issues, &(&1.exit_status == 2))
  end

  test "allows only interpreter shebangs at the start of the file" do
    assert check("#!/usr/bin/env elixir\n:ok\n") == []
    assert check("#! /usr/bin/elixir\r\n:ok\r\n") == []

    for source <- ["\n#!/usr/bin/elixir\n", " #!/usr/bin/elixir\n", "#! ordinary comment\n", "#!\n"] do
      assert [_issue] = check(source)
    end

    assert [issue] = check("#!/usr/bin/elixir\n#! later comment\n")
    assert issue.line_no == 2
  end

  test "ignores hashes in strings, charlists, sigils, heredocs and documentation attributes" do
    source = ~S|
    defmodule Example do
      @moduledoc "# documentation"
      @doc "# function documentation"
      def value do
        ["# string", '# charlist', ~s(# sigil), ~S(#{not_interpolation}), ~r/# regex/,
         ?#, :"# atom", "escaped \" # string", """
        # heredoc
        """, '''
        # charlist heredoc
        ''']
      end
    end
    |

    assert check(source) == []
  end

  test "detects comments inside string and sigil interpolation" do
    source = ~S'''
    "#{
      # interpolation
      :ok
    }"
    ~s(#{
      # sigil interpolation
      :ok
    })
    '''

    assert Enum.map(check(source), & &1.line_no) == [2, 6]
  end

  test "handles CRLF and unicode before trailing comments" do
    assert [issue] = check("\"λ\" # comment\r\n")
    assert {issue.line_no, issue.column} == {1, 5}
  end

  test "leaves invalid syntax to Credo parser diagnostics" do
    assert check("defmodule Broken do\n# comment\n") == []
  end

  test "ships the check as a high priority failing default" do
    assert {NoComments, params} = List.keyfind(TheThracianCredo.checks(), NoComments, 0)
    assert params[:exit_status] == 2
    assert params[:priority] == :high
  end

  defp check(source) do
    source
    |> SourceFile.parse("lib/example.ex")
    |> NoComments.run(exit_status: 2)
  end
end
