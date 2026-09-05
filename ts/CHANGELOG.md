# Changelog

## 0.6.0 - 2026-08-09

### Breaking Changes

- fix(ts)!: replace noisy lint rules with strict signal (#29) (c4d143c)

## Unreleased (next breaking release)

### Breaking Changes

- Enabled `thethracian/no-comments` in every preset. Lexical comments, including JSDoc and
  suppression directives, are forbidden; interpreter shebangs remain allowed. Removed the
  contradictory assertion-safety-comment and Effect suppression-comment requirements.
- Replaced the broad style/performance preset with an explicit allowlist of approved upstream
  Oxlint rules. Every active rule is an `error`; there is no warning tier and no rule-level `off`
  entry. Rules that the audit found noisy or behavior-changing are omitted from the allowlist.
- Oxlint's implicit `correctness` warnings are neutralized once with a category-level
  `correctness: 'allow'` reset before the approved rules are assigned `error`. The reset prevents
  hidden defaults from leaking into the preset; it does not weaken an active rule.
- Raised the minimum supported Oxlint version to `1.66.0`, the first release that provides the
  syntax-only `no-implied-eval` rule used by the base preset. Minimum-peer CI now resolves and
  compares the complete type-aware and Effect-enabled rule set.
- Split the upstream allowlist into 128 syntax-only errors and 32 semantic errors. The semantic
  rules are emitted only with `typeAware: true`, so the base preset no longer advertises checks
  that Oxlint cannot execute without its type-aware backend.
- Retained `import/no-duplicates` and `oxc/only-used-in-recursion` as errors because they detect
  duplicate imports and dead recursive parameters without imposing a representation preference.
- Changed the structural limits to complexity `20`, nesting depth `5`, function length `150`
  lines, nested callbacks `6`, and parameters `7`. Line width is delegated to the formatter.
- Removed maximum file-length and import-count enforcement. Removed noisy naming, null, ternary,
  magic-number, global `console`, custom line-length, file/function documentation, and absolute
  `any`/non-null/type-assertion bans from the exported preset. Type-aware unsafe-operation rules
  remain errors.
- Removed the audited generic homegrown rules, the flagged Effect preference rules, and the
  semantically unsound module-scope rules from the package itself. They are not merely disabled in
  configuration. The retained Effect plugin provides 18 safety rules, 19 specialized analyzers, and
  60 strict architecture rules (97 total); it remains disabled by default. `effect: true` enables
  exactly the 18 safety errors, the specialized rules remain registered for explicit rule
  configuration, and strict architecture rules require explicit names and path groups.
- Strict Effect architecture rules now require explicit `effect.strict.rules` selections and the
  path groups relevant to those rules. A blanket `strict: true`, unknown rule names, missing paths,
  and malformed path options now fail fast instead of silently changing the active policy.
- Semantic codemod implementations remain available as an explicit, reviewed migration command;
  they are never part of lint fixes or staged-file workflows. The unsafe acronym renamer and its
  1,574-entry policy dictionary were removed rather than repackaged as a migration transform.
- Repository CI and staged-file checks now build and use the local package under development. The
  release verification PR still runs the newly published package as a downstream consumer.

### Rationale

The previous profile made mechanically tidy code look healthy while encouraging shim modules,
sentinel values, forced naming rewrites, and semantic codemod churn. The revised policy keeps
homegrown rules with a concrete Effect safety or architecture signal, removes the audited generic
rules, and uses an explicit upstream allowlist for the base. A green run is evidence of correctness
and resource safety: if a rule cannot reliably identify a defect, it is absent rather than
downgraded to a warning.

## 0.5.2 - 2026-08-03

### Changes

- perf: make oxlint analysis stack-safe (63753f8)

## 0.5.1 - 2026-08-02

### Fixes

- fix: avoid recursive source line scans (1fa51d1)

## 0.5.0 - 2026-08-01

### Features

- feat: idiomatic effect rules (#25) (ea9850f)

## 0.4.0 - 2026-07-24

### Features

- feat(ts): add effect lint analysis and stable-value rule (#23) (52e2384)

## 0.3.6 - 2026-05-31

### Fixes

- fix: add codemod quality gate and fix edge cases (#21) (0ed6616)

## 0.3.5 - 2026-05-27

### Fixes

- fix: protect type contracts in acronym codemod (#19) (ec70982)

## 0.3.4 - 2026-05-25

### Fixes

- fix: improve function doc diagnostics (#17) (c6e721f)

## 0.3.3 - 2026-05-25

### Fixes

- fix: make thracian lint rules less brittle (#15) (0030478)

## 0.3.2 - 2026-05-25

### Changes

- chore: keep performance gates local (#12) (08ab247)
- chore: migrate ts rules and codemods to effect (#11) (0ee131b)

## 0.3.1 - 2026-05-25

### Changes

- chore(ts): consume published oxlint config (#8) (5a1b72a)

## 0.3.0 - 2026-05-25

### Features

- feat(ci): keep performance gate local (#7) (635fdfe)
- feat(ts): rewrite codemod fixers with jscodeshift (#6) (989d924)

## 0.2.1 - 2026-05-24

### Changes

- perf: optimize effect oxlint rules (#3) (3efe102)

## 0.2.0 - 2026-05-24

### Features

- feat: add strict Effect oxlint rules (#2) (f27729e)

## 0.1.0 - 2026-05-23

### Added

- Initial release.
