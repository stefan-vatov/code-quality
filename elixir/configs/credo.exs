%{
  configs: [
        %{
          name: "default",
          requires: ["./.credo_checks/**/*.ex"],
          files: %{
            included: ["lib/", "src/", "web/", "apps/", "test/"],
            excluded: [~r"/_build/", ~r"/deps/"]
      },
      strict: true,
      parse_timeout: 5000,
      color: true,
      checks: %{
            disabled: [
              {Credo.Check.Readability.ModuleDoc, []}
            ],
            extra: [
              {Credo.Check.Readability.MaxLineLength,
               [max_length: 150, exit_status: 2, priority: :high]},
              {TheThracian.Credo.Check.Refactor.FunctionBodyLength,
               [max_lines: 75, exit_status: 2, priority: :high]},
              {Credo.Check.Refactor.Nesting,
               [max_nesting: 3, exit_status: 2, priority: :high]},
              {Credo.Check.Refactor.FunctionArity,
               [max_arity: 5, exit_status: 2, priority: :high]},
              {Credo.Check.Refactor.CyclomaticComplexity,
               [max_complexity: 10, exit_status: 2, priority: :high]},
              {Credo.Check.Warning.IoInspect, []}
            ]
          }
    }
  ]
}
