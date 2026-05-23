defmodule TheThracianCredo.MixProject do
  use Mix.Project

  def project do
    [
      app: :the_thracian_credo,
      version: "0.1.0",
      elixir: "~> 1.15",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      description: "Credo plugin and installer for The Thracian Elixir lint rules.",
      package: package(),
      source_url: "https://github.com/stefan-vatov/code-quality"
    ]
  end

  def application do
    [
      extra_applications: [:logger]
    ]
  end

  defp deps do
    [
      {:credo, "~> 1.7", runtime: false}
    ]
  end

  defp package do
    [
      licenses: ["MIT"],
      links: %{"GitHub" => "https://github.com/stefan-vatov/code-quality"},
      files: ["lib", "mix.exs", "README.md", "CHANGELOG.md", "LICENSE", ".formatter.exs"]
    ]
  end
end
