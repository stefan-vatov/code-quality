# Changelog

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
