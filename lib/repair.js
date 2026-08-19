/**
 * Collapse duplicated profile-local packages onto the global install.
 *
 * Each real copy is moved into a timestamped backup directory and replaced with
 * a symlink to the global package. Node resolves module identity by real path,
 * so the symlink makes the profile and the global bundles share one instance —
 * which is the whole point (see `scan.js`).
 *
 * Moving rather than deleting keeps the operation reversible: `restore()` puts
 * every backed-up copy back exactly where it was.
 *
 * @module repair
 */

import { renameSync, symlinkSync, mkdirSync, rmSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';

/** Backup layout keeps the scope directory so a restore is a plain rename back. */
function backupPathFor(backupDir, name) {
  return join(backupDir, name);
}

/**
 * Replace each duplicate with a symlink to its global counterpart.
 *
 * @param {Array} duplicates - entries from `scanProfile().duplicates`.
 * @param {{backupDir: string, dryRun?: boolean}} opts
 * @returns {{applied: Array, failed: Array, backupDir: string}}
 */
export function linkDuplicates(duplicates, { backupDir, dryRun = false }) {
  const applied = [];
  const failed = [];

  for (const entry of duplicates) {
    if (dryRun) {
      applied.push({ name: entry.name, action: 'would link' });
      continue;
    }
    const dest = backupPathFor(backupDir, entry.name);
    try {
      mkdirSync(dirname(dest), { recursive: true });
      // Move the real copy aside, then point the original path at the global one.
      renameSync(entry.localPath, dest);
      try {
        symlinkSync(entry.globalPath, entry.localPath);
      } catch (linkError) {
        // Never leave the profile without the package: put the copy back.
        renameSync(dest, entry.localPath);
        throw linkError;
      }
      applied.push({ name: entry.name, action: 'linked', backup: dest });
    } catch (error) {
      failed.push({ name: entry.name, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { applied, failed, backupDir };
}

/**
 * Undo a previous `linkDuplicates` run by moving backed-up copies back.
 *
 * @param {{backupDir: string, profileRoot: string}} opts
 * @returns {{restored: Array, failed: Array}}
 */
export function restore({ backupDir, profileRoot }) {
  const restored = [];
  const failed = [];
  if (!existsSync(backupDir)) return { restored, failed };

  const names = [];
  for (const entry of readdirSync(backupDir)) {
    if (entry.startsWith('@')) {
      for (const sub of readdirSync(join(backupDir, entry))) names.push(`${entry}/${sub}`);
    } else names.push(entry);
  }

  for (const name of names) {
    const from = join(backupDir, name);
    const to = join(profileRoot, 'node_modules', name);
    try {
      // The live path is expected to be the symlink this tool created.
      if (existsSync(to) || lstatSync(to, { throwIfNoEntry: false })) {
        rmSync(to, { recursive: true, force: true });
      }
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
      restored.push(name);
    } catch (error) {
      failed.push({ name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { restored, failed };
}
