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
            disabled: [],
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
              {Credo.Check.Warning.IoInspect, []},
              {Credo.Check.Warning.IExPry, []},
              {Credo.Check.Refactor.VariableRebinding,
               [exit_status: 2, priority: :high]},
              {Credo.Check.Readability.Specs,
               [exit_status: 2, priority: :high]},
              {Credo.Check.Readability.ModuleDoc,
               [exit_status: 2, priority: :high]},
              {Credo.Check.Readability.AliasOrder,
               [exit_status: 2, priority: :high]},
              {Credo.Check.Readability.StrictModuleLayout,
               [exit_status: 2, priority: :high]},
              {ThethracianLintConfig.Checks.MaxDirectoryDepth,
               [max: 4, exit_status: 2, priority: :high]},
              {Credo.Check.Warning.UnusedEnumOperation,
               [exit_status: 2, priority: :high]},
              {Credo.Check.Warning.UnsafeExec,
               [exit_status: 2, priority: :high]}
            ]
          }
    }
  ]
}
