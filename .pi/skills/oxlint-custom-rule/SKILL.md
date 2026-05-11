# Write a custom Oxlint JS plugin rule

Use this skill when adding a new custom lint rule to the `@thethracian/oxlint-config` package. Do not create a new package — rules live inside the existing `ts/` package.

## Architecture

One package (`ts/`, publishing as `@thethracian/oxlint-config`). Rules go into `ts/src/rules/`, compile to `ts/dist/rules/`, and the config references them via `jsPlugins`.

```
ts/
├─ src/
│  ├─ index.ts              ← config export (already exists)
│  └─ rules/
│     ├─ plugin.ts           ← plugin wrapper (exports rule objects)
│     └─ <rule-name>.ts      ← individual rule logic
├─ test/
│  └─ rules/
│     ├─ <rule-name>.test.ts ← TDD tests
│     └─ fixtures/
│         ├─ valid.ts        ← fixture: no violations expected
│         └─ invalid.ts      ← fixture: violations expected
└─ dist/
   └─ rules/
      ├─ plugin.js           ← compiled output
      └─ <rule-name>.js
```

## Step-by-step plan

1. Research the rule semantics thoroughly (what should it catch vs allow).
2. Write test fixture files (`valid.ts`, `invalid.ts`) first.
3. Write the test file with the fixture tests and individual behavior tests.
4. Implement the rule logic in `ts/src/rules/<rule-name>.ts`.
5. Register the rule in `ts/src/rules/plugin.ts`.
6. Wire the rule into the config in `ts/src/index.ts`.
7. Run tests → `npx vitest run --config vitest.config.mts ts/test/rules/<rule-name>.test.ts`
8. Run build → `pnpm run build`
9. Run coverage → append `--coverage` to vitest command. Target 100% line coverage; branch coverage may be lower due to equivalent mutants in heuristic code (acceptable).
10. Run stryker → `pnpm run test:mutation`. Score ≥ 60% is acceptable for heuristic/pattern-matching rules due to equivalent mutants in string literals and regex patterns.
11. Update `AGENTS.md` (policy + implementation lines) and the `ts/README.md`.
12. Commit with conventional commit style.

## Oxlint JS plugin API reference

### Rule shape (ESLint-compatible `create` API)

```ts
const rule = {
  create(context: {
    report: (descriptor: { message: string; loc: { line: number; column: number } }) => void;
    filename: string;
  }) {
    return {
      // AST node visitors
      Program() {
        /* runs once per file */
      },
      // Other AST visitors as needed
    };
  },
};
```

### Plugin shape

```ts
const plugin = {
  meta: { name: 'thethracian' },
  rules: {
    '<rule-name>': <rule-object>,
  },
};
export default plugin;
```

### Supported APIs

Oxlint JS plugins support the ESLint v9 plugin API for AST inspection. Supported:

- `context.report({ message, loc })` or `context.report({ message, node })`
- `context.filename` — the file being linted
- AST node visitors (e.g., `Program`, `FunctionDeclaration`, etc.)
- `readFileSync` from `node:fs` for reading file contents (needed for comment/source-text analysis)

Not supported (as of 2026-05): token-based APIs (`sourceCode.getComments()`, `sourceCode.getTokens()`), type-aware APIs in JS plugins.

### Wiring into config

```ts
// ts/src/index.ts
jsPlugins: ['oxlint-plugin-complexity', './rules/plugin.js'],
rules: {
  'thethracian/<rule-name>': 'error',
  // ...
}
```

The path `./rules/plugin.js` is relative to the compiled `dist/index.js`.

## Rule implementation patterns

### Pattern A: Pure heuristic (scoring system)

Best for detection rules where AST structure alone is insufficient (e.g., commented-out code detection, comment analysis). Extract a pure function with the core logic, test it thoroughly, then wrap in the Oxlint rule.

```ts
// <rule-name>.ts — export the pure function for testing
export default function myHeuristic(input: string): boolean {
  // scoring logic, fast-paths, penalties
  return score >= THRESHOLD;
}

// plugin.ts — wrap for Oxlint
import myHeuristic from './<rule-name>.js';

const rule = {
  create(context) {
    return {
      Program() {
        const source = readFileSync(context.filename, 'utf-8');
        // Parse relevant parts from source, call heuristic
        if (myHeuristic(somePart)) {
          context.report({ message: '...', loc: { line, column } });
        }
      },
    };
  },
};
```

### Pattern B: AST visitor

Best when the rule targets specific AST nodes.

```ts
const rule = {
  create(context) {
    return {
      FunctionDeclaration(node) {
        if (someCondition(node)) {
          context.report({ message: '...', node });
        }
      },
    };
  },
};
```

## Testing

### Test file structure

```ts
import { describe, expect, it } from 'vitest';
import myHeuristic from '../../src/rules/<rule-name>.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fixturesDir = join(import.meta.dirname, 'fixtures');

describe('myHeuristic', () => {
  // Individual behavior tests
  it('detects something', () => { ... });
  it('does not flag something else', () => { ... });
});

describe('fixture files', () => {
  function parseFromSource(source: string): string[] { /* extract relevant parts */ }

  it('valid fixture contains zero violations', () => {
    const source = readFileSync(join(fixturesDir, 'valid.ts'), 'utf-8');
    const parts = parseFromSource(source);
    const violations = parts.filter(myHeuristic);
    expect(violations).toHaveLength(0);
  });

  it('invalid fixture contains violations', () => {
    const source = readFileSync(join(fixturesDir, 'invalid.ts'), 'utf-8');
    const parts = parseFromSource(source);
    const violations = parts.filter(myHeuristic);
    expect(violations.length).toBeGreaterThanOrEqual(expectedCount);
  });
});
```

### Heuristic testing principles

- Use positive cases (must detect) and negative cases (must not detect).
- Test edge cases: empty inputs, boundaries, whitespace, punctuation.
- Test false-positive prevention thoroughly: natural language, documentation, task markers, directives.
- Test threshold boundaries: score exactly at vs below vs above the cut-off.
- If using a scoring system, test each scoring component independently.

### Running tests

```sh
# Run all tests for a rule
npx vitest run --config vitest.config.mts ts/test/rules/<rule-name>.test.ts

# With coverage
npx vitest run --config vitest.config.mts --coverage ts/test/rules/<rule-name>.test.ts

# Stryker mutation testing
pnpm run test:mutation
```

## Pre-commit hook gotchas

The monorepo's pre-commit hook runs `oxlint --type-aware --type-check` on all staged `*.ts` files. Watch for these rules tripping:

| Rule                           | Issue                                              | Fix                                                   |
| ------------------------------ | -------------------------------------------------- | ----------------------------------------------------- |
| `eslint/id-length`             | Short variable names (`i`, `m`)                    | Use descriptive names (`idx`, `match`)                |
| `eslint/init-declarations`     | `let x: Type;` without initialization              | Use `let x: Type = defaultValue;` or restructure      |
| `eslint/prefer-destructuring`  | `m[1]` array access                                | Use `const [, body] = match;`                         |
| `eslint/no-unused-vars`        | Fixture files have unused functions                | Add `export` to fixture functions                     |
| `import/prefer-default-export` | Single named export                                | Use default export for the pure heuristic function    |
| `typescript/*` (type-aware)    | Test files import `node:fs` but aren't in tsconfig | Add `**/test/**` to `.oxlintrc.json` `ignorePatterns` |

The `.oxlintrc.json` at the repo root already excludes `**/test/**` and `**/fixtures/**` from linting.

## Heuristic design checklist

When building a scoring-based heuristic:

- [ ] Define clear code indicators (keywords, patterns, structural markers).
- [ ] Each indicator adds weight — ensure no single indicator alone reaches threshold (prevents most false positives).
- [ ] Add fast-path early exits for obviously-not-code inputs (length < 3, no code-like tokens).
- [ ] Add penalties for natural language (articles, prepositions, sentence structure, JSDoc tags, URLs).
- [ ] Skip natural-language penalties when code indicators are already present.
- [ ] Test every scoring component independently.
- [ ] Test boundary conditions (score exactly at threshold, just below, just above).
- [ ] Test overlapping words (words that are both code keywords and natural language, e.g., `for`, `in`, `of`, `new`, `is`, `it`).
- [ ] Test false positives exhaustively with real natural language sentences.
- [ ] If using regex patterns for detection, test that mutating a single character in the pattern doesn't change behavior (equivalent mutants are expected in pattern-matching code).

## Mutation testing expectations

For heuristic/pattern-matching rules, expect 60-80% mutation score. String literal mutants in regex patterns and keyword sets are often **equivalent** (same behavior). These are not missing test cases — they're inherent to this type of code. The repo's stryker config uses `high: 65`, `low: 50`, `break: null` to reflect this.

## Build and verify before commit

```sh
pnpm run build        # compile all packages incl. ts/dist/rules/
pnpm run check        # typecheck all packages
npx vitest run --config vitest.config.mts --coverage ts/test/rules/<rule-name>.test.ts
pnpm run lint         # optional, test files already excluded from oxlint pre-commit
```

## Commit style

Lowercase conventional commits. Example:

```
feat: add custom oxlint <rule-name> rule

implement scoring heuristic that detects <what it catches>
by <how it works>,

<N> tests at 100% line coverage, <N> fixtures,
plugin shipped with config via jsPlugins,

update agents.md, ts readme, and package docs.
```
