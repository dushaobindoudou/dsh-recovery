# dsh-selfrepair

[![CI](https://github.com/dushaobindoudou/dsh-selfrepair/actions/workflows/ci.yml/badge.svg)](https://github.com/dushaobindoudou/dsh-selfrepair/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-selfrepair.svg)](https://www.npmjs.com/package/dsh-selfrepair)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-green.svg)](package.json)

Diagnose and repair a [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) (dsh)
installation. Several failure modes motivated it, all of which surface as
something unrelated to their cause - a plugin that cannot mount, a model that
cannot be found, a boot that silently falls back.

Three repair surfaces, one engine:

| Surface | Where | Works when dsh cannot start |
| --- | --- | --- |
| **诊断 settings page** | `dsh web` -> 设置 -> 诊断 | no |
| **`/doctor` slash command** | inside any dsh session | no |
| **`dsh-selfrepair` CLI** | any shell | **yes** |

The CLI is the primary entry point on purpose: the worst failure this tool fixes
stops dsh from reaching a prompt at all, so a slash command is unreachable
exactly when it is most needed.

## Install

```sh
npm install -g dsh-selfrepair
```

gives you the `dsh-selfrepair` command everywhere. To mount the in-app
surfaces into a profile:

```sh
cd ~/.dsh/profiles/<name>
npm install dsh-selfrepair
```

then in `~/.dsh/profiles/<name>/cordis.patch.yml`:

```yaml
- insert:
    - id: plugin-selfrepair
      name: dsh-selfrepair
```

`insert` adds a row. A bare `- id:` entry *patches an existing* row and fails
with `patch: entry "..." not found`. Restart `dsh web` once so the new row
enters the loader graph; the settings page needs no further restarts.

## What it checks

### 1. Profile packages duplicating the global install (`duplicate-modules`)

A profile plugin that declares `@deepseek-ai/*` as ordinary **dependencies**
(rather than peerDependencies) makes pnpm install a second real copy of the whole
dsh tree into the profile's `node_modules` - including `@deepseek-ai/cordis`.

Node keys ESM module identity by **resolved real path**, so the profile then runs
two independent dependency-injection systems:

```
@deepseek-ai/dsh-base   (global) -> global cordis, global dsh-system-prompt
dsh-acp-server          (local)  -> LOCAL  cordis, LOCAL  dsh-system-prompt
```

Services registered by one are invisible to the other. An agent preset's
`dsh-persona` row is scope-only: it may shadow the deployment persona *within an
agent scope*, but with the registries split it cannot see that scope, registers
globally, and collides with `dsh-system-prompt`'s own unconditional registration:

```
agent-presets: preset "cordis" failed to mount: failed to apply loader entry
persona (@deepseek-ai/dsh-persona): prompt section "deployment:persona" is
already registered
```

Every preset ships that row, so **every** preset fails and no session can start.

**Fix:** replace each copy with a symlink to the global package, which realpath
collapses onto one instance. Deleting instead would break resolution outright -
a profile's `node_modules` is not nested under the global install. Copies are
**moved** to a timestamped backup, never deleted.

Packages whose local version differs from the global one are reported and left
alone: relinking those would silently change the dependency a plugin was built
against.

### 2. Unusable model configuration (`llm-config`)

dsh merges a user block over built-in provider defaults, so a stray value
silently replaces a working one:

```yaml
llm-deepseek:
  baseURL: "11111"     # replaces https://api.deepseek.com
  models: []           # empties the built-in model list
```

The symptom is "model configuration not found", with nothing pointing at the
override.

**Fix:** remove only the unusable keys. A block left with no keys is dropped
entirely - that is what restores the built-in default; an empty block would still
shadow it. Blocks containing a real `providers:` tree are never touched, so
hand-written provider definitions are safe. The file is backed up first.

### 3. Broken settings.yaml (`settings-yaml`)

`settings.yaml` is loaded and merged on every boot. A hand edit can corrupt the
indentation or turn a block into a scalar, and the symptom (model config not
found, a boot that silently falls back) points nowhere near the file.

**Fix:** none - the tool cannot know what the damaged file was meant to say. The
check reports the parse error and the offending top-level block so the damage is
findable. (An empty file is healthy: it means "no overrides".)

### 4. Unresolvable default model (`agent-default-model`)

`agent-default-model: { provider, model }` selects the model every new session
starts with. If it names a provider the user configured but a model that
provider's `models:` list does not contain, the selection cannot work and every
session fails before the first prompt.

Only **provable** mismatches are reported: a provider that is NOT among the
user's `providers:` trees may be a built-in catalog entry whose model list lives
inside dsh, so it is left alone. `fix` is not available - the user must edit the
selection.

### 5. Missing API key (`api-key`)

A provider's `apiKeyEnv` names a credential *reference* resolved by the
credentials service from the stored credential **or** the process environment -
exactly what `dsh-llm-pi-ai` consults before throwing `MISSING_CREDENTIAL`. This
check mirrors that resolution: a provider whose `apiKeyEnv` is in neither
`~/.dsh/.credentials.yaml` nor the environment is flagged, because its first
model call would fail. Only key **names** are read, never values.

## The settings page

Open **设置 -> 诊断**. The page is read-mostly - opening it runs a check but
never writes. Only the checks that found a problem are listed; a healthy install
shows a single **一切正常** hero and nothing else.

Two detection modes, switched at the top of the page:

- **AI 检测** (default when the host reports a usable default model and adapter
  route): runs the rule checks and hands the collected evidence - env paths,
  every rule result, and the raw `settings.yaml` - to the default model for a
  second opinion, shown as an AI 分析 card. A model failure degrades to the
  rules-only view with an error note.
- **规则检测**: the five checks only.

If AI is unavailable (no default model, or the provider has no adapter) the AI
option is disabled with the reason and the page falls back to rules.

A **重新检查** and **一键修复** button sit in a bottom-right action bar that
stays fixed while the page content scrolls. Per-check fixes double-confirm;
一键修复 is one deliberate click and applies every fixable repair. Every fix
backs up first, and after a `duplicate-modules` fix the result reminds you to
restart dsh for it to take effect.

> The nav icon for the section is the settings gear: the settings panel's
> section icons are hardcoded in dsh's own `dsh-client-ui-settings-general`
> bundle, so a third-party section cannot choose one without patching shipped
> code.

## CLI

```sh
dsh-selfrepair                      # every profile
dsh-selfrepair status --profile web
dsh-selfrepair fix --profile web
dsh-selfrepair --fix --profile web  # --fix supplies the fix action with no positional
dsh-selfrepair fix --only llm-config --profile web
dsh-selfrepair restore --profile web  # undo the most recent fix from its backup
dsh-selfrepair status --json        # machine-readable
```

Exit code is 1 when anything is unhealthy, so it works in a health check.

## Every fix is reversible

A fix that cannot be undone is worse than no fix: these repairs touch a user's
installed packages and their settings file. Every fix writes a backup first -
relinked packages are moved to `.dsh-doctor-backup/<timestamp>/`, and
`settings.yaml` is copied to `settings.yaml.doctor-backup` - and `restore`
(also `/doctor restore` inside dsh) reverses the most recent fix from the backup
it left behind.

## Slash command

```
/doctor          # report (default) - never writes
/doctor fix      # apply the fixable repairs
/doctor restore  # reverse the most recent fix
```

## Adding a check

`lib/checks/*.js`, registered in `lib/checks/index.js`:

```js
export const myCheck = {
  id: 'my-check',
  title: 'Human readable title',
  severity: 'critical',        // or 'warning'
  fixable: true,
  detect(env) {                // env = { profileRoot, globalRoot, dshHome }
    return { ok: false, summary: '...', detail: ['...'], findings: [...] };
  },
  fix(env, findings) {
    return { fixed: ['...'], failed: [], note: 'backup: ...' };
  },
  undo(env) {                  // optional: enables `restore`
    return { restored: ['...'], failed: [] };
  },
};
```

`detect` must never write: the report is safe to run at any time. A check that
throws is reported as a failed check rather than aborting the run, so one broken
probe cannot hide the rest of the diagnosis.

## Scope

This is a repair tool, not a cure. Running `pnpm install` or `dsh plugin add` in
a profile re-creates the duplicated copies and the failure returns. The permanent
fix belongs upstream: plugins should declare `@deepseek-ai/*` as
**peerDependencies**, as the first-party dsh plugins do. This package does that
for its own dependencies, so it can never become the problem it diagnoses.

### Why the peers are `optional`

dsh symlinks its own dependency tree into the shared `~/.dsh/profiles/node_modules/`
fallback on every boot, so a plugin that declares `@deepseek-ai/*` as **optional**
peers resolves them to the *same instance* dsh itself runs - one dependency
injection system. The moment npm installs real copies next to the plugin, the
realpath identity splits and the `duplicate-modules` failure reappears. Optional
peers are what keeps the cure from causing the disease.

## Development

```sh
git clone https://github.com/dushaobindoudou/dsh-selfrepair.git
cd dsh-selfrepair
npm install
npm test        # 84 tests, no network, no dsh install required
```

Tests reproduce both original failures in a sandbox and assert the full
fix -> restore round trip.

For a symlinked dev checkout mounted into a profile, point the protocol peer at
the running dsh's own copy (same trick as the sibling plugins) so both halves
share one instance:

```sh
G=$(dirname $(realpath $(which dsh)))/../lib/node_modules/@deepseek-ai/dsh/node_modules
ln -sfn "$G/@deepseek-ai/dsh-typert-protocol" node_modules/@deepseek-ai/dsh-typert-protocol
```

## License

[MIT](LICENSE)
