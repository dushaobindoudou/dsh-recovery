/**
 * Detect packages a dsh profile has installed as REAL COPIES of packages that
 * already exist in the global dsh install.
 *
 * Why this matters: dsh loads bundles like `@deepseek-ai/dsh-base` from the
 * global install, while a profile-local plugin (e.g. `dsh-acp-server`) loads its
 * own copy from the profile's `node_modules`. Node keys ESM module identity by
 * resolved real path, so two copies of `@deepseek-ai/cordis` are two independent
 * dependency-injection systems. Services registered in one are invisible to the
 * other, and an agent preset then fails to mount with
 * `prompt section "deployment:persona" is already registered`.
 *
 * The fix is not to delete the copy — Node would fail to resolve the package at
 * all, since a profile's `node_modules` is not nested under the global install.
 * It is to replace the copy with a symlink to the global one, which realpath
 * collapses onto a single module instance.
 *
 * A differing version does NOT make a copy harmless. For an ordinary library
 * (`zod`) two versions coexist fine, but the harness's own module graph must be
 * one instance whatever the version: after a `dsh` upgrade the global tree moves
 * ahead of every profile-local copy, so *every* stale `@deepseek-ai/*` copy is
 * exactly the split this tool exists to catch. Those are reported separately
 * (`diverged`) rather than filed as by-design retention.
 *
 * @module scan
 */

import { readdirSync, readFileSync, lstatSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Whether a package's module identity is load-bearing for the harness.
 *
 * The `@deepseek-ai/` scope is the harness's own module graph — the DI
 * container (`cordis`), its plugin loader, the schema and utility packages
 * those two share, and every `dsh-*` service. They ship in lockstep from one
 * release and are only usable as a single instance per process. Anything
 * outside the scope is an ordinary library that may legitimately exist twice.
 */
function isHarnessCore(name) {
  return name.startsWith('@deepseek-ai/');
}

/** Numeric `major.minor.patch` prefix of a version, or null when unparsable. */
function releaseTuple(version) {
  if (typeof version !== 'string') return null;
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return m === null ? null : { major: Number(m[1]), minor: Number(m[2]) };
}

/**
 * Whether relinking a local copy onto the global one stays inside one release
 * line — the semver-caret rule, where `0.x` treats the minor as the major.
 *
 * Inside a line the relink is the same version move a reinstall against the
 * upgraded global tree would make anyway; across lines it is a breaking change,
 * so the split has to be resolved by reinstalling the profile instead.
 */
export function sameReleaseLine(localVersion, globalVersion) {
  const a = releaseTuple(localVersion);
  const b = releaseTuple(globalVersion);
  if (a === null || b === null) return false;
  if (a.major !== b.major) return false;
  return a.major !== 0 || a.minor === b.minor;
}

/** Read a package's version, or null when it has no readable manifest. */
function versionOf(pkgDir) {
  try {
    return JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

/** List package dirs under a node_modules root, expanding `@scope/` one level. */
function listPackages(nodeModules) {
  if (!existsSync(nodeModules)) return [];
  const out = [];
  for (const entry of readdirSync(nodeModules)) {
    if (entry === '.bin' || entry === '.modules.yaml') continue;
    if (entry.startsWith('@')) {
      const scopeDir = join(nodeModules, entry);
      let inner = [];
      try {
        inner = readdirSync(scopeDir);
      } catch {
        continue;
      }
      for (const sub of inner) out.push({ name: `${entry}/${sub}`, dir: join(scopeDir, sub) });
    } else {
      out.push({ name: entry, dir: join(nodeModules, entry) });
    }
  }
  return out;
}

/**
 * Classify every profile-local package against the global install.
 *
 * @param {{profileRoot: string, globalRoot: string}} opts
 *   `profileRoot` is the profile directory (the one holding `package.json` with
 *   a `dsh.profile` field); `globalRoot` is the `@deepseek-ai/dsh` package dir.
 * @returns {{duplicates: Array, diverged: Array, skipped: Array, linked: Array}}
 *   `duplicates` are real copies of the same version, `diverged` are real copies
 *   of a harness-core package whose version has drifted from the global tree
 *   (each carrying `relinkable`), `skipped` are ordinary libraries whose version
 *   differs and may stay, and `linked` are already-symlinked entries needing no
 *   action.
 */
export function scanProfile({ profileRoot, globalRoot }) {
  const localNM = join(profileRoot, 'node_modules');
  const globalNM = join(globalRoot, 'node_modules');

  const duplicates = [];
  const diverged = [];
  const skipped = [];
  const linked = [];

  for (const { name, dir } of listPackages(localNM)) {
    const globalDir = join(globalNM, name);
    // Only packages the global install also provides can be collapsed; a
    // profile-only package (the plugin the user actually installed) must stay.
    if (!existsSync(globalDir)) continue;

    let isLink = false;
    try {
      isLink = lstatSync(dir).isSymbolicLink();
    } catch {
      continue;
    }
    if (isLink) {
      linked.push({ name, localPath: dir, globalPath: globalDir });
      continue;
    }

    const localVersion = versionOf(dir);
    const globalVersion = versionOf(globalDir);
    const entry = { name, localPath: dir, globalPath: globalDir, localVersion, globalVersion };

    if (localVersion !== null && localVersion === globalVersion) {
      duplicates.push(entry);
      continue;
    }
    // The version differs. For the harness's own module graph that is still a
    // split instance — an upgraded `dsh` puts every profile in this state — so
    // it is a finding, relinkable while the release line holds. For any other
    // library two versions are legitimate and relinking would silently swap the
    // dependency a plugin was built against, so it stays where it is.
    if (isHarnessCore(name)) {
      diverged.push({ ...entry, reason: 'version diverged', relinkable: sameReleaseLine(localVersion, globalVersion) });
    } else {
      skipped.push({ ...entry, reason: 'version mismatch' });
    }
  }

  const byName = (a, b) => a.name.localeCompare(b.name);
  return {
    duplicates: duplicates.sort(byName),
    diverged: diverged.sort(byName),
    skipped: skipped.sort(byName),
    linked: linked.sort(byName),
  };
}
