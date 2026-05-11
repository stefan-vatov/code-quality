import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "configs/credo.exs",
  "configs/dialyzer_ignore.exs",
  "configs/mix_dialyzer_snippet.exs"
];

await Promise.all(requiredFiles.map((file) => access(file)));

const credo = await readFile("configs/credo.exs", "utf8");
if (!credo.includes("Credo.Check.Warning.IoInspect")) {
  throw new Error("Invalid Credo check module name in configs/credo.exs");
}
