/**
 * The last configuration this installation was known to be healthy with.
 *
 * The targeted repairs answer "what is broken and how is it undone". They
 * cannot answer "what did this look like when it worked" — for three of the
 * five checks (`settings-yaml`, `agent-default-model`, `api-key`) the tool has
 * no way to know what the damaged config was *meant* to say, so it reports and
 * stops. A recorded known-good state is the missing half: not a repair derived
 * from the damage, but the state itself, put back.
 *
 * **Recorded on the writing path only.** `detect` must never write (the
 * settings page runs it on every open), so a snapshot is taken at the end of a
 * repair run that leaves the installation healthy — which is exactly the
 * "configure it, then run `dsh doctor` once" moment. A snapshot identical to
 * the newest one is not recorded again, so the timestamp stays meaningful.
 *
 * **Configuration only, never credentials.** `~/.dsh/.credentials.yaml` is not
 * snapshotted and never will be: this tool reads credential key *names* and
 * never their values, and copying a plaintext key store around to enable a
 * rollback would trade that discipline for a small convenience. A provider with
 * a missing API key therefore stays report-only — no rollback can fix it.
 *
 * @module knowngood
 */

import { readdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';

/** Snapshot root inside the profile, beside `.dsh-doctor-backup`. */
export const KNOWN_GOOD_DIR = '.dsh-doctor-known-good';
const SNAPSHOTS = 'snapshots';
const PRE_ROLLBACK = 'pre-rollback';
/** How many snapshots to keep; older ones are pruned as new ones land. */
const KEEP = 5;

/**
 * The files a snapshot records.
 *
 * `settings.yaml` is the Harness home's, shared by every profile — restoring it
 * from one profile's snapshot affects them all, which the rollback report says
 * out loud. `cordis.patch.yml` is the profile's own plugin row list.
 */
export function snapshotFiles({ dshHome, profileRoot }) {
  return [
    { name: 'settings.yaml', path: join(dshHome, 'settings.yaml'), scope: 'dsh home (shared by every profile)' },
    { name: 'cordis.patch.yml', path: join(profileRoot, 'cordis.patch.yml'), scope: 'this profile' },
  ];
}

/** Timestamped directory name, sortable as a string. */
function stamp(now) {
  return now.toISOString().replace(/[:.]/g, '-');
}

/** Existing snapshot directories, oldest first. */
function snapshotDirs(profileRoot) {
  const root = join(profileRoot, KNOWN_GOOD_DIR, SNAPSHOTS);
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root).sort().map((entry) => join(root, entry));
  } catch {
    return [];
  }
}

/** The most recent known-good snapshot directory, or null when none exists. */
export function latestKnownGood(profileRoot) {
  const dirs = snapshotDirs(profileRoot);
  return dirs.length === 0 ? null : dirs[dirs.length - 1];
}

/** A snapshot's manifest, or null when unreadable. */
export function readSnapshotManifest(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Whether a snapshot's recorded files are byte-identical to the live ones. */
function matchesLive(dir, files) {
  const manifest = readSnapshotManifest(dir);
  if (manifest === null || !Array.isArray(manifest.files)) return false;
  const recorded = new Set(manifest.files);
  const live = files.filter((f) => existsSync(f.path)).map((f) => f.name);
  if (recorded.size !== live.length || !live.every((name) => recorded.has(name))) return false;
  return live.every((name) => {
    const file = files.find((f) => f.name === name);
    try {
      return readFileSync(join(dir, name), 'utf8') === readFileSync(file.path, 'utf8');
    } catch {
      return false;
    }
  });
}

/** The version of the dsh install a snapshot is taken against, or null. */
function dshVersion(globalRoot) {
  try {
    return JSON.parse(readFileSync(join(globalRoot, 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

/** Drop all but the newest `keep` snapshots. */
function prune(profileRoot, keep) {
  const dirs = snapshotDirs(profileRoot);
  for (const dir of dirs.slice(0, Math.max(0, dirs.length - keep))) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // A snapshot that cannot be pruned is harmless; never fail a repair for it.
    }
  }
}

/**
 * Record the current configuration as known-good.
 *
 * Never throws: this runs at the tail of a successful repair, and a snapshot
 * that cannot be written must not turn a working repair into a failure.
 *
 * @returns {{dir: string, files: string[], reused: boolean}|null} null when
 *   there was nothing to record or the write failed.
 */
export function recordKnownGood(env, { now = new Date(), keep = KEEP } = {}) {
  try {
    const files = snapshotFiles(env).filter((f) => existsSync(f.path));
    if (files.length === 0) return null;

    // An unchanged configuration keeps its original snapshot, so "known-good
    // from <date>" names when the state was last *different*, not when the
    // command last ran.
    const newest = latestKnownGood(env.profileRoot);
    if (newest !== null && matchesLive(newest, files)) {
      return { dir: newest, files: files.map((f) => f.name), reused: true };
    }

    const dir = join(env.profileRoot, KNOWN_GOOD_DIR, SNAPSHOTS, stamp(now));
    mkdirSync(dir, { recursive: true });
    for (const file of files) copyFileSync(file.path, join(dir, file.name));
    writeFileSync(
      join(dir, 'manifest.json'),
      `${JSON.stringify({
        recordedAt: now.toISOString(),
        profile: basename(env.profileRoot),
        dshVersion: dshVersion(env.globalRoot),
        files: files.map((f) => f.name),
      }, null, 2)}\n`,
    );
    prune(env.profileRoot, keep);
    return { dir, files: files.map((f) => f.name), reused: false };
  } catch {
    return null;
  }
}

/**
 * Put the most recent known-good configuration back.
 *
 * What it replaces is itself backed up first — a rollback that cannot be undone
 * would be the one irreversible operation in a tool whose whole premise is that
 * every write is reversible.
 *
 * @returns {{from: string|null, restored: string[], failed: Array<{name: string, error: string}>, backup: string|null, recordedAt: string|null}}
 */
export function rollbackToKnownGood(env, { now = new Date() } = {}) {
  const from = latestKnownGood(env.profileRoot);
  if (from === null) return { from: null, restored: [], failed: [], backup: null, recordedAt: null };

  const manifest = readSnapshotManifest(from);
  const names = Array.isArray(manifest?.files) ? manifest.files : [];
  const byName = new Map(snapshotFiles(env).map((f) => [f.name, f]));
  const backup = join(env.profileRoot, KNOWN_GOOD_DIR, PRE_ROLLBACK, stamp(now));

  const restored = [];
  const failed = [];
  for (const name of names) {
    const target = byName.get(name);
    if (target === undefined) continue;
    try {
      const source = join(from, name);
      if (!existsSync(source)) continue;
      if (existsSync(target.path)) {
        mkdirSync(backup, { recursive: true });
        copyFileSync(target.path, join(backup, name));
      }
      copyFileSync(source, target.path);
      restored.push(name);
    } catch (error) {
      failed.push({ name, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    from,
    restored,
    failed,
    backup: existsSync(backup) ? backup : null,
    recordedAt: typeof manifest?.recordedAt === 'string' ? manifest.recordedAt : null,
  };
}
