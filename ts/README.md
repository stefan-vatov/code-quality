# @thethracian/oxlint-config

Importable Oxlint config for TypeScript projects.

The config errors on lines over 150 characters, files over 500 lines, functions over 75 lines, nesting deeper than 3 levels, more than 5 parameters, cyclomatic complexity over 10, denies debug artifacts (no-console, no-debugger), bans silent catch blocks (no-empty), bans commented-out code (custom thethracian/no-commented-out-code rule), bans inline comments and warning comments (no-inline-comments, no-warning-comments), denies unsafe `any` escape hatches (no-unsafe-call, no-unsafe-member-access, plus no-unsafe-assignment/return/argument when type-aware), denies unhandled promises (no-floating-promises, no-misused-promises when type-aware), and enforces immutability with prefer-const and no-param-reassign (including property mutations).

Requires `oxlint-plugin-complexity` (peer dependency) for the cyclomatic complexity rule.

```ts
import theThracian from '@thethracian/oxlint-config';

export default theThracian();
```
