# Security Policy

## Supported versions

Only the latest release on `main` receives fixes.

## Reporting a vulnerability

Please do **not** open a public issue. Use [GitHub security advisories]
(https://github.com/dushaobindoudou/dsh-selfrepair/security/advisories/new)
so the fix can ship before disclosure. Include a reproducer if you can.

## Scope notes

This tool is intentionally conservative:

- It reads only credential **names** (`apiKeyEnv`), never values.
- `status` (the default action everywhere - page, `/doctor`, CLI) never
  writes a single byte. Only `fix` writes, and only after copying what it
  is about to change into a timestamped backup.
- The AI detection mode sends a bounded snapshot of `settings.yaml` to the
  locally-configured default model - names and structure, never credential
  values. If that is unacceptable in your environment, the rules-only mode
  shares nothing.
- Repairs run with the invoking user's permissions and touch only the dsh
  home (`$DSH_HOME`) and the global dsh installation's own files.
