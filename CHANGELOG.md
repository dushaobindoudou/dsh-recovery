# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-09-18

### Changed

- **Dual-name release: `dsh-recovery` (primary) + `dsh-selfrepair` (twin).**
  npm does not support in-place renames, so 0.6.0 introduced `dsh-recovery`
  (bins: `dsh-recovery`, `dsh-doctor`) while `dsh-selfrepair` continues to be
  published in lockstep from the same codebase (`node scripts/publish-both.mjs`)
  — no deprecation, existing installs keep working with identical updates.
  GitHub repository renamed to `dsh-recovery` (old URLs redirect).
- The client bundle id, plugin patch row name (`dsh-recovery`), usage texts and
  docs follow the primary name; the patch row id stays `plugin-selfrepair` so
  existing known-good snapshots keep parsing.
## [0.5.0] - 2026-09-18

dsh 0.1.5-rc.2 compatibility release.

### Added

- **`broken-links` check (report-only)**: detects the failure class a
  project/workspace move leaves behind — dangling `link:`/`file:` dependency
  targets in the profile's package.json, dangling node_modules symlinks
  (including stale `.dsh-module-fallback` chains), and cordis.patch.yml rows
  whose package cannot be resolved. Before this check, `status` reported
  "No problems found" (exit 0) on a profile that could not start at all.
  Report-only by design: the repair needs to know where the project moved.
- The check ships with client settings-page card titles (zh/en) and unit
  tests; the remote `info`/`status` payloads include it.

### Fixed

- **AI detection provider lookup (P1)**: the capability probe matched
  `p.provider` against `llm.listProviders()` entries, but `LlmProviderInfo`
  is `{id, name}` on every dsh version — `providerKnown` was always false, so
  AI mode was never available on any real dsh. The fixture mocks that hid the
  bug now use the real shape.
- **README (P1)**: the `dsh doctor` subcommand route does not exist on the
  stock 0.1.5 launcher (only `web` and `plugin`); the docs now recommend the
  standalone `dsh-selfrepair` / `dsh-doctor` bins and say what happened to
  the launcher patch.

## [0.4.0] - 2026-09-09

### Added

- **Known-good configuration snapshots and `rollback`.** Three of the five
  checks are report-only because the tool cannot know what a damaged config
  was *meant* to say — but it can know what it *used to be*. A repair run that
  ends healthy records `settings.yaml` and the profile's `cordis.patch.yml`
  under `.dsh-doctor-known-good/snapshots/<timestamp>/`, and
  `dsh doctor rollback` (`/doctor rollback`, `dsh-selfrepair rollback`) puts
  the most recent one back. This recovers breakage no targeted repair can:
  a `settings.yaml` that no longer parses, a default model pointing at a model
  that does not exist, a hand-edited `cordis.patch.yml`.
  - Recorded on the writing path only — `detect` must never write, so the
    snapshot is taken at the end of a healthy repair run, which is the
    "configure it, then run `dsh doctor` once" moment.
  - An unchanged configuration keeps its existing snapshot, so the recorded
    timestamp names when the state last *differed*; the newest 5 are kept.
  - A rollback backs up what it replaces under
    `.dsh-doctor-known-good/pre-rollback/<timestamp>/`, so it is as reversible
    as every other write this tool makes.
  - **`~/.dsh/.credentials.yaml` is never snapshotted.** This tool reads
    credential key names and never their values; copying a plaintext key store
    around to enable a rollback would trade that discipline away. A provider
    with a missing API key therefore stays report-only.
  - `restore` and `rollback` answer different questions and both remain:
    `restore` reverses *this tool's* last fix, `rollback` reverses whatever
    broke the configuration since it last worked.
- An unhealthy report names the recorded snapshot when one exists, so the
  rollback is discoverable at the moment it is needed.
- The 诊断 / Doctor settings page is fully bilingual. Dictionaries are
  registered with the host `locale` service under `settings.doctor` and the
  bound `t` renders the tab label, every control, every status line and the
  check card titles — the same contract the first-party
  `@deepseek-ai/dsh-client-ui-*` settings tabs use. A fallback lookup (document
  language, Chinese otherwise) keeps the page readable on a host that predates
  the injection, because a diagnostics page that will not render is worthless
  exactly when it is needed. The AI analysis is now requested in the language
  the page is being read in.
- The settings page can undo. `restore` (reverse this tool's last fix) and
  `rollback` (put the last known-good configuration back) are Remote endpoints
  and action-bar buttons, both confirming in place like the existing fixes. The
  bar also names when the known-good configuration was recorded, and disables
  the rollback when there is none.

### Fixed

- Settings page, both themes: the warning severity used
  `--dsw-alias-state-warning-primary`, which is not a host token — it resolves
  to nothing, so the warning dot rendered invisible and the warning card lost
  its accent border. The host's token is `--dsw-alias-state-warn-primary`.
  Both `agent-default-model` and `api-key` report at warning severity, so this
  hit the two most common findings.
- Settings page, dark mode: text on a brand-colored fill was a literal
  `#fff`. `--dsw-alias-brand-primary` is near-black in light mode and
  near-white in dark mode, so the selected detection-mode chip's label was
  white on white and disappeared. It now uses
  `--dsw-alias-label-primary-foreground`, which flips with the fill.
- `duplicate-modules` reported a healthy profile after a `dsh` upgrade. The
  check only failed on copies whose version *matched* the global install, so
  when the global tree moved to a new release every profile-local
  `@deepseek-ai/*` copy diverged and fell into the by-design bucket — the
  scan printed `No problems found.` for exactly the module-identity split it
  exists to catch (verified against `dsh` 0.1.2-rc.1: 15 stale copies in the
  `web` profile, including `@deepseek-ai/cordis`, reported OK). `scanProfile`
  now returns those as `diverged`, and the check fails on them.
- `api-key` check false positives: credential reference names are read from the
  `refs:` mapping of the version-1 `.credentials.yaml` layout (what
  `dsh-credentials-local` writes), instead of the document's top level —
  which only ever holds `version`/`refs`/`records`, so every configured
  provider was reported as keyless. The pre-release flat layout stays
  tolerated, and the never-read-values discipline is unchanged.

### Changed

- **Breaking (CLI):** the `doctor` action repairs instead of reporting — it is
  now an alias for `fix`, not for `status`. `dsh doctor` is the command reached
  for when dsh is broken, so it has to leave the installation usable rather
  than print a diagnosis; `status` (still the no-action default) remains the
  read-only path, and `--json` health checks should name it explicitly. Every
  repair still backs up what it touches, and `dsh doctor restore` reverses it.
  The `/doctor` slash command is unchanged: bare `/doctor` reports, `/doctor
  fix` repairs — an in-session repair cannot take effect until a restart
  anyway.
- Settings page interaction details: the host's focus ring on every control
  (keyboard traversal now looks native), `font: inherit` on buttons, hover
  backgrounds from `--dsw-alias-interactive-bg-hover`, `aria-pressed` on the
  mode toggle, `aria-busy` while a write runs, and an `aria-live` region so a
  screen reader hears the verdict change. Long paths and package names wrap
  instead of overflowing.
- The `fix` action of the CLI prints `Nothing to fix.` when a run had nothing
  to apply, matching the slash command.
- Running-process detection matches the dsh **executable** rather than any
  command line containing `dsh`, and excludes the current process and its
  parent. Routing `dsh doctor` through the `dsh` launcher had made the repair
  note name the shell and the launcher that were running the repair itself.
- `duplicate-modules` distinguishes three kinds of profile-local copy: a
  same-version `duplicate`, a stale harness copy (`@deepseek-ai/*`, reported
  and relinked onto the global version — the report names each version move
  and `restore` reverses it), and an ordinary library whose version differs
  (kept as a local copy by design, unchanged). A harness copy from a different
  release line is reported but not offered as fixable: the check reports
  `fixable: false` for that run and points at reinstalling the profile.
- `peerDependencies` accepts the whole `@deepseek-ai/dsh-typert-protocol`
  0.1.x line (`>=0.1.0-rc.6 <0.2.0`) instead of pinning the single
  `0.1.0-rc.6` release, which no `dsh` currently ships; the devDependency and
  the lockfile move to `0.1.2-rc.1` so CI typechecks against the harness the
  plugin actually runs on (`npm ls` was failing with `ELSPROBLEMS`).
- `duplicate-modules`: an OK verdict with version-diverged packages now says
  `N version-diverged package(s) kept as local copies by design` in the
  summary, and the detail line explains why (relinking would change the
  version) instead of the ambiguous `left alone:`.
- `duplicate-modules` fix/undo notes name the running dsh processes (PIDs)
  that still hold pre-fix module copies when any are detected, so the
  restart requirement is explicit instead of implicit (2026-08-27 incident:
  an 11-minute broken window because the restart was not called out).

## [0.3.0] - 2026-08-24

### Added

- `doctor` CLI action: an alias for `status`, matching the `/doctor` slash
  command spelling (`dsh-selfrepair doctor` == `dsh-selfrepair status`).
- `dsh-doctor` binary: a second `bin` entry pointing at the same entry point, so
  the diagnostics run as `dsh-doctor [status|fix|restore] ...` when that name is
  more natural (e.g. alongside `npx`).
- The `dsh doctor` subcommand (the global `dsh` CLI's launcher patches its
  `bin.js` to shell out to `dsh-selfrepair` before any profile boot, so it keeps
  working even when a profile cannot start). This lives in the installed dsh
  launcher and needs re-applying if the global `dsh` package is upgraded.

## [0.2.0] - 2026-08-19

### Added

- One-command install as a dsh plugin bundle: `dsh plugin --profile <name> add dsh-selfrepair`
  composes the shipped `cordis.patch.yml` through the new `dsh.bundle.patch`
  manifest field - no manual profile YAML editing.
- TypeScript declarations for the whole public API (`types` entry,
  `exports.*.types` conditions, contract in `lib/types.d.ts`), checked in CI
  with `tsc --strict`.
- Bilingual docs: README.zh.md mirroring README.md, plus CONTRIBUTING.md,
  SECURITY.md, issue templates, PR template, and `examples/healthcheck.sh`
  (exit-code contract for cron/launchd).

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

[0.4.0]: https://github.com/dushaobindoudou/dsh-selfrepair/releases/tag/v0.4.0
[0.2.0]: https://github.com/dushaobindoudou/dsh-selfrepair/releases/tag/v0.2.0
[0.1.0]: https://github.com/dushaobindoudou/dsh-selfrepair/releases/tag/v0.1.0
