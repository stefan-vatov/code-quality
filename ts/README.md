# @thethracian/oxlint-config

Importable Oxlint config for TypeScript projects.

The config errors on lines over 150 characters, files over 500 lines, functions over 75 lines, nesting deeper than 3 levels, more than 5 parameters, and cyclomatic complexity over 10.

Requires `oxlint-plugin-complexity` (peer dependency) for the cyclomatic complexity rule.

```ts
import theThracian from '@thethracian/oxlint-config';

export default theThracian();
```
