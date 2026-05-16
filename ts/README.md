# @thethracian/oxlint-config

Importable Oxlint config for TypeScript projects.

The config errors on lines over 150 characters, files over 500 lines, functions over 75 lines, nesting deeper than 3 levels, callback nesting deeper than 4 levels (max-nested-callbacks), more than 5 parameters, cyclomatic complexity over 10, requires strict equality (eqeqeq), denies eval and dynamic code execution (no-eval, no-implied-eval when type-aware), denies debug artifacts (no-console, no-debugger), bans silent catch blocks (no-empty), bans commented-out code (custom thethracian/no-commented-out-code rule), bans inline comments and warning comments (no-inline-comments, no-warning-comments), bans `any` and untyped escape hatches (no-explicit-any, no-unsafe-call, no-unsafe-member-access, plus no-unsafe-assignment/return/argument when type-aware), denies unhandled promises (no-floating-promises, no-misused-promises when type-aware), and enforces immutability with prefer-const and no-param-reassign (including property mutations).

Requires `oxlint-plugin-complexity` (peer dependency) for the cyclomatic complexity rule.

```sh
pnpm add -D @thethracian/oxlint-config oxlint@^1.63.0 oxlint-tsgolint@^0.22.1 oxlint-plugin-complexity
```

```ts
import theThracian from '@thethracian/oxlint-config';

export default theThracian();
```
