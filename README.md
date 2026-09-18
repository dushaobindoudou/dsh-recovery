# dsh-selfrepair

[![npm](https://img.shields.io/npm/v/dsh-selfrepair.svg)](https://www.npmjs.com/package/dsh-selfrepair)
[![CI](https://github.com/dushaobindoudou/dsh-selfrepair/actions/workflows/ci.yml/badge.svg)](https://github.com/dushaobindoudou/dsh-selfrepair/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Diagnose and repair a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) installation.**

Five checks that catch the failures which surface as something unrelated to their cause - a plugin that cannot mount, a model that cannot be found, a boot that silently falls back - and reversible repairs for the fixable ones.

English | [中文](README.zh.md)

## What it does

Three repair surfaces, one engine:

| Surface | Where | Works when dsh cannot start |
|---|---|---|
| **诊断 settings page** | `dsh web` -> 设置 -> 诊断 | no |
| **`/doctor` slash command** | inside any dsh session | no |
| **`dsh-selfrepair` CLI** | any shell | **yes** |

The CLI is the primary entry point on purpose: the worst failure this tool fixes stops dsh from reaching a prompt at all, so a slash command is unreachable exactly when it is most needed.

| Check | Finds | Auto-fix |
|---|---|---|
| `duplicate-modules` | profile packages that shadow the global dsh install - two dependency-injection systems, every agent preset fails to mount | ✅ relink + backup |
| `llm-config` | stray `llm-*` keys that silently replace working provider defaults (`baseURL: "11111"`) | ✅ remove bad keys + backup |
| `settings-yaml` | `settings.yaml` that no longer parses, and the block that broke it | report-only |
| `agent-default-model` | a default model the selected provider's `models:` list does not contain | report-only |
| `api-key` | providers whose `apiKeyEnv` is neither in the credential store nor the environment | report-only |

Report-only is deliberate: for those three the tool cannot know what the damaged config was *meant* to say. Only key **names** are ever read - never values.

## Install

Requires Node.js ≥ 20 and the `dsh` CLI (`npm i -g @deepseek-ai/dsh`).

One command adds the plugin to a profile - it installs the package, keeps
`dsh.profile.bundles` in sync, and composes the shipped bundle patch (the
row that mounts this plugin):

```bash
dsh plugin --profile web add dsh-selfrepair
```

Restart `dsh web` once and **设置 -> 诊断** appears.

The standalone CLI needs no profile at all - install it globally for the
rescue path:

```bash
npm install -g dsh-selfrepair
dsh-selfrepair status          # diagnoses every profile it finds
```

<details>
<summary>Manual install (no <code>dsh plugin</code>)</summary>

```bash
cd ~/.dsh/profiles/<name>
npm install dsh-selfrepair
```

then add the row to `~/.dsh/profiles/<name>/cordis.patch.yml`:

```yaml
- insert:
    - id: plugin-selfrepair
      name: 'dsh-selfrepair'
```

`insert` adds a row; a bare `- id:` entry *patches an existing* one and fails
with `patch: entry "..." not found`.

</details>

## The 诊断 settings page

The page is read-mostly - opening it runs a check but never writes. Only the
checks that found a problem are listed; a healthy install shows a single
**一切正常** and nothing else.

Two detection modes, switched at the top:

- **AI 检测** (default when a usable default model is configured): runs the
  rule checks, then hands the evidence - env paths, every rule result, the
  raw `settings.yaml` (names only, never credential values) - to the default
  model for a second opinion, shown as an AI 分析 card. A model failure
  degrades to the rules-only view.
- **规则检测**: the five checks only.

**重新检查** and **一键修复** sit in a bottom-right action bar fixed while
the page scrolls. Per-check fixes confirm in place (click twice); 一键修复
is one deliberate click that applies every fixable repair.

## CLI reference

```bash
dsh-selfrepair doctor                 # diagnose AND repair, every profile - the one command to reach for
dsh-doctor doctor                     # the same thing under the shorter binary name
dsh-selfrepair                        # status, every profile (the default action never writes)
dsh-selfrepair status                 # read-only through the subcommand too
dsh-selfrepair fix --profile web      # repair one profile (`fix` is what `doctor` is an alias for)
dsh-selfrepair --fix --profile web    # --fix supplies the action with no positional
dsh-selfrepair fix --only llm-config  # scope to one check id
dsh-selfrepair restore --profile web  # undo the most recent fix, from its backup
dsh-selfrepair rollback --profile web # put the last known-good configuration back
dsh-selfrepair status --json          # machine-readable
```

`doctor` repairs; `status` reports. The command reached for when dsh is broken
has to leave it working, not print a diagnosis - so `doctor` diagnoses, applies
every fixable repair, and prints what remains. Every repair backs up what it
touches and `restore` reverses it. Relinked modules only take effect in a *new*
process, so the repair report names the running dsh processes that still hold
the pre-fix copies.

Exit code is 1 when anything is unhealthy, so it drops straight into a health
check - see [`examples/healthcheck.sh`](examples/healthcheck.sh). Use `status`
there: it is the action that never writes.

> **`dsh doctor` does not work on dsh 0.1.5-rc.2.** The stock 0.1.5 launcher
> only routes the `web` and `plugin` subcommands. The custom `doctor` route
> this README used to advertise was a local patch to the installed launcher
> (`@deepseek-ai/dsh/lib/bin.js`), and a dsh upgrade wipes it — it has to be
> re-applied by hand after every upgrade. The standalone global bins
> `dsh-selfrepair` / `dsh-doctor` survive upgrades untouched; use those.

Slash command, inside any dsh session of the profile:

```
/doctor           # report (default) - never writes
/doctor fix       # apply the fixable repairs
/doctor restore   # reverse the most recent fix
/doctor rollback  # put the last known-good configuration back
```

## Every fix is reversible

A fix that cannot be undone is worse than no fix: these repairs touch a
user's installed packages and their settings file. Every fix writes a backup
first - relinked packages move to `.dsh-doctor-backup/<timestamp>/`,
`settings.yaml` is copied to `settings.yaml.doctor-backup` - and `restore`
reverses the most recent fix from the backup it left behind.

## The last configuration that worked

Three of the five checks are report-only because the tool cannot know what a
damaged config was *meant* to say. It can know what it *used to be*: a repair
run that ends healthy records `settings.yaml` and the profile's
`cordis.patch.yml` as a known-good snapshot, and `dsh-selfrepair rollback` puts the
most recent one back.

```bash
dsh-selfrepair doctor # configure it, run this once - the healthy state is recorded
# ...something breaks the config...
dsh-selfrepair rollback # put the recorded state back
```

That recovers what no targeted repair can: a `settings.yaml` that no longer
parses, a default model naming a model that does not exist, a hand-edited
`cordis.patch.yml`. Snapshots live in
`.dsh-doctor-known-good/snapshots/<timestamp>/` (newest 5 kept), an unchanged
configuration keeps its existing snapshot so the timestamp names when the state
last *differed*, and a rollback backs up what it replaces under
`.dsh-doctor-known-good/pre-rollback/<timestamp>/`.

`restore` and `rollback` answer different questions: `restore` reverses *this
tool's* last fix; `rollback` reverses whatever broke the configuration since it
last worked, whoever did it.

**`~/.dsh/.credentials.yaml` is never snapshotted.** This tool reads credential
key *names* and never their values, and copying a plaintext key store around to
enable a rollback would trade that discipline for a small convenience - so a
provider with a missing API key stays report-only, and no rollback will fix it.

Recording happens on the writing path only. `detect` may never write (the
settings page runs it on every open), so the snapshot is taken at the end of a
repair run that leaves the installation healthy.

## How the worst failure works

A profile plugin that declares `@deepseek-ai/*` as ordinary **dependencies**
(rather than peerDependencies) makes pnpm install a second real copy of the
whole dsh tree into the profile's `node_modules` - including
`@deepseek-ai/cordis`. Node keys ESM module identity by resolved real path,
so the profile then runs two dependency-injection systems, and services
registered by one are invisible to the other:

```
@deepseek-ai/dsh-base   (global) -> global cordis, global dsh-system-prompt
dsh-acp-server          (local)  -> LOCAL  cordis, LOCAL  dsh-system-prompt
```

Every agent preset fails to mount with
`prompt section "deployment:persona" is already registered`, and no session
can start. The fix replaces each copy with a symlink to the global package -
realpath collapses onto one instance. Copies are *moved* to a backup, never
deleted.

### A `dsh` upgrade puts every profile in that state

Upgrading the global `dsh` moves its whole `@deepseek-ai/*` tree to a new
release while each profile keeps the copies its lockfile pins - so the split
arrives without anyone touching the profile. A differing version does not make
the copy harmless: the harness's own module graph is only usable as one
instance per process, whatever the version numbers say. Those stale copies are
therefore reported as a failure and relinked onto the global version, which is
the same move a reinstall against the upgraded tree would make (the report
names each version change, and `restore` reverses it).

Ordinary libraries are the opposite case - two versions of `zod` coexist fine,
and relinking would silently change the dependency a plugin was built against,
so a non-`@deepseek-ai/*` package whose version differs is kept as a local copy
by design. A harness copy from a *different release line* (`3.x` local vs `4.x`
global) is reported but not relinked either: that one needs the profile
reinstalled against the upgraded `dsh`.

### Why the peers are `optional`

dsh symlinks its own dependency tree into the shared
`~/.dsh/profiles/node_modules/` fallback on every boot, so a plugin that
declares `@deepseek-ai/*` as **optional** peers resolves them to the *same
instance* dsh itself runs - one dependency injection system. The moment npm
installs real copies next to the plugin, the realpath identity splits and the
`duplicate-modules` failure reappears. Optional peers are what keeps the cure
from causing the disease.

## Adding a check

`lib/checks/*.js`, registered in `lib/checks/index.js` - full contract in
[`lib/types.d.ts`](lib/types.d.ts):

```js
export const myCheck = {
  id: 'my-check',
  title: 'Human readable title',
  severity: 'critical',        // or 'warning'
  fixable: true,
  detect(env) {                // env = { profileRoot, globalRoot, dshHome }
    return { ok: false, summary: '...', detail: ['...'], findings: [...] };
  },
  fix(env, findings) {         // back up, then write
    return { fixed: ['...'], failed: [], note: 'backup: ...' };
  },
  undo(env) {                  // optional: enables `restore`
    return { restored: ['...'], failed: [] };
  },
};
```

`detect` must never write: the report is safe to run at any time. A check
that throws is reported as a failed check rather than aborting the run, so
one broken probe cannot hide the rest of the diagnosis.

## Development

```bash
git clone https://github.com/dushaobindoudou/dsh-selfrepair.git
cd dsh-selfrepair
npm install
npm test         # 149 tests, no network, no dsh install required
npm run typecheck
```

Tests reproduce both original failures in a sandbox and assert the full
fix -> restore round trip.

For a symlinked dev checkout mounted into a profile, point the protocol peer
at the running dsh's own copy (same trick as the sibling plugins) so both
halves share one instance:

```bash
G=$(dirname $(realpath $(which dsh)))/../lib/node_modules/@deepseek-ai/dsh/node_modules
ln -sfn "$G/@deepseek-ai/dsh-typert-protocol" node_modules/@deepseek-ai/dsh-typert-protocol
```

## Contributing

PRs welcome - see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports go to
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
