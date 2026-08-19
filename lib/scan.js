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
 * @module scan
 */

import { readdirSync, readFileSync, lstatSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
 * @returns {{duplicates: Array, skipped: Array, linked: Array}}
 *   `duplicates` are real copies that are safe to relink (identical versions),
 *   `skipped` are real copies that are NOT safe (version differs), and `linked`
 *   are already-symlinked entries needing no action.
 */
export function scanProfile({ profileRoot, globalRoot }) {
  const localNM = join(profileRoot, 'node_modules');
  const globalNM = join(globalRoot, 'node_modules');

  const duplicates = [];
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

    // Relinking across versions would silently downgrade or upgrade the plugin's
    // dependency, so those are reported and left alone.
    if (localVersion !== null && localVersion === globalVersion) duplicates.push(entry);
    else skipped.push({ ...entry, reason: 'version mismatch' });
  }

  const byName = (a, b) => a.name.localeCompare(b.name);
  return {
    duplicates: duplicates.sort(byName),
    skipped: skipped.sort(byName),
    linked: linked.sort(byName),
  };
}
