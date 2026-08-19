## What & why

<!-- One or two sentences: what this changes, and which failure or friction it addresses. -->

## Checklist

- [ ] `npm test` and `npm run typecheck` pass
- [ ] `detect` never writes (the report stays read-only)
- [ ] every new `fix` leaves a backup; `undo` ships when reversal is possible
- [ ] credential **names** only - never values - in any new read path
- [ ] both READMEs updated if the check table or CLI changed
- [ ] CHANGELOG.md entry added (or "none needed")

## Test plan

<!-- How you verified this - sandbox repro, before/after output, etc. -->
