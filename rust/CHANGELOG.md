# Changelog

## Unreleased

### Added

- Added `cargo thx-lint check`, a stable lexer-based ban on Rust line, block, and documentation
  comments across first-party workspace members. Literal text and interpreter shebangs remain allowed.

### Changed

- Removed documentation requirements from the installed rustc and Clippy policy to avoid
  conflicting with comment-free source code. Run the new check alongside Clippy in CI.

## 0.1.0 - 2026-05-23

### Added

- Initial release.
