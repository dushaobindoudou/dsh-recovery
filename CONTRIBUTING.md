# Contributing to dsh-selfrepair

Thanks for helping make dsh installs repairable. This project is small on
purpose - read this first and your PR will land fast.

## Ground rules

- **A check's `detect` never writes.** The report must stay safe to run at
  any time, from any surface (page, slash command, CLI). Only `fix` writes,
  and it backs up first.
- **Every fix needs an escape hatch.** If your check ships a `fix`, ship the
  matching `undo` whenever the backup makes reversal possible. A fix that
  cannot be undone is worse than no fix.
- **Read names, never values.** Anything touching credentials or settings
  must only ever surface key *names* (`apiKeyEnv`), never the values.

## Setup

```bash
git clone https://github.com/dushaobindoudou/dsh-selfrepair.git
cd dsh-selfrepair
npm install
npm test              # must pass before you push
npm run typecheck     # declarations must compile under --strict
```

Tests need no network and no dsh installation - everything runs in temp
directories.

## Adding a check

1. Create `lib/checks/<id>.js` following the `Check` contract in
   `lib/types.d.ts` (also shown in the README).
2. Register it in `lib/checks/index.js` - order there is repair order.
3. Add tests in `test/<id>.test.js` covering at minimum:
   - the healthy case is `ok`,
   - each detected problem,
   - `fix` leaves a backup and produces the healthy state,
   - `undo` (if present) restores the pre-fix state byte-for-byte,
   - `detect` throws are contained (a broken probe reports, never aborts).
4. Update both READMEs' check table, and the settings page needs no change -
   it renders whatever the registry returns.

## Commit style

Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`), wrapped
at 72 chars, imperative mood. Look at `git log` for the tone.

## Reporting bugs

Open an issue with the output of:

```bash
dsh-selfrepair status --json
```

(and say which surface you came from - CLI, `/doctor`, or the settings page).

## Releasing

Maintainers: bump `version` in `package.json`, add a `CHANGELOG.md` entry,
run the full suite, tag `v<x.y.z>`, push, then `npm publish`. CI must be
green on `main` first.
