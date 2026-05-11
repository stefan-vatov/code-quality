import { access } from "node:fs/promises";

const requiredFiles = [
  "configs/rustfmt.toml",
  "configs/clippy.toml",
  "configs/cargo-lints-package.toml",
  "configs/cargo-lints-workspace.toml"
];

await Promise.all(requiredFiles.map((file) => access(file)));
