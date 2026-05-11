%{
  configs: [
    %{
      name: "default",
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
          {Credo.Check.Warning.IoInspect, []}
        ]
      }
    }
  ]
}
