# Changelog

## 0.2.0 - 2026-09-05

### Breaking Changes

- feat!: ban source comments across typescript, rust, and elixir (7a8f47d)

### Fixes

- fix: make installer version assertions release-safe (11d9525)
- fix(elixir): inherit the selected runtime in consumer tests (90f710f)

## Unreleased

- Ban lexical comments by default with the parser-based `NoComments` Credo check,
  including interpolation comments and suppression directives. Allow only a first-line
  interpreter shebang, matching the cross-language policy.
- Prevent inline Credo directives from concealing issues in suggest, list, and diff runs.
- Activate the comment policy through the shared checks used by fresh and existing installers.
- Reject unknown installer options before writing files.

## 0.1.0 - 2026-05-23

### Added

- Initial release.
