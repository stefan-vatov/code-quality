dialyzer: [
  plt_add_apps: [:mix, :ex_unit],
  flags: [:unmatched_returns, :error_handling, :extra_return, :missing_return],
  ignore_warnings: ".dialyzer_ignore.exs"
]
