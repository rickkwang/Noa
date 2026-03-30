# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.7] - 2026-03-30

### Fixed
- Smoke test selector for Graph tab now uses exact role-name matching to avoid strict-mode ambiguity in CI.

## [1.0.6] - 2026-03-30

### Added
- CI dependency audit gate for high-severity issues.
- Playwright E2E coverage for note creation, search, and import/export.
- In-app diagnostics export and feedback entry points.

### Changed
- Tightened release and backup guidance in the UI copy.

### Fixed
- File sync architecture boundary and backup/import error mapping.
