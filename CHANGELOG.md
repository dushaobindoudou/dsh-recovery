# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-19

### Added

- Five checks: duplicated profile modules, unusable model configuration,
  malformed `settings.yaml`, unusable `agent-default-model`, and missing
  provider API keys.
- Three repair surfaces: a 诊断 (diagnostics) section in the `dsh web`
  settings page, a `/doctor` slash command inside dsh, and a standalone
  `dsh-selfrepair` CLI that runs even when dsh itself cannot start.
- One-click repair (`一键修复`) and per-problem repair with confirm-in-place,
  problems-only rendering (a clean install shows a single 一切正常).
- AI-powered diagnosis mode: when a default model is configured, the settings
  page asks it to interpret the rule-engine findings; falls back to rule
  detection otherwise.
- Every fix is reversible: backups under `.dsh-doctor-backup/` and
  `settings.yaml.doctor-backup`, restored by `/doctor restore` or
  `dsh-selfrepair restore` (`--only <check-id>` scopes both fix and restore).
- Exit code 1 when unhealthy, `--json` for machine-readable output.

[0.1.0]: https://github.com/dushaobindoudou/dsh-selfrepair/releases/tag/v0.1.0
