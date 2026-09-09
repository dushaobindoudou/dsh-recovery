/**
 * Check: profile-local packages duplicating the global dsh install.
 *
 * See `../scan.js` for why this breaks preset mounting. In short: two real
 * copies of `@deepseek-ai/cordis` are two dependency-injection systems, so an
 * agent preset's persona row cannot see its agent scope and fails with
 * `prompt section "deployment:persona" is already registered`.
 *
 * A `dsh` upgrade is the most likely way to reach that state: the global tree
 * moves to the new release while the profile keeps the copies its lockfile
 * pins, so the split arrives without anyone touching the profile. Those stale
 * harness copies are therefore a FAIL, not by-design retention — see
 * `scanProfile`'s `diverged` bucket.
 *
 * @module checks/duplicate-modules
 */

import { scanProfile } from '../scan.js';
import { linkDuplicates, restore } from '../repair.js';
import { backupDirFor, latestBackup } from '../paths.js';
import { runningDshProcesses } from '../processes.js';

/** After a repair, name the live processes that still hold pre-fix copies. */
function restartNote() {
  const running = runningDshProcesses();
  if (running.length > 0) {
    const pids = running.map((p) => p.pid).join(', ');
    return `Restart dsh for this to take effect: ${running.length} running dsh process(es) still hold the pre-fix module copies (PID ${pids}).`;
  }
  return 'Restart dsh for this to take effect.';
}

export const duplicateModules = {
  id: 'duplicate-modules',
  title: 'Profile packages duplicating the global dsh install',
  severity: 'critical',
  fixable: true,

  detect({ profileRoot, globalRoot }) {
    const scan = scanProfile({ profileRoot, globalRoot });
    const relinkable = scan.diverged.filter((d) => d.relinkable);
    const blocked = scan.diverged.filter((d) => !d.relinkable);
    const findings = [...scan.duplicates, ...relinkable];

    const detail = [];
    for (const d of scan.duplicates) detail.push(`duplicate: ${d.name}@${d.localVersion}`);
    for (const d of relinkable) {
      detail.push(`stale duplicate: ${d.name} (local ${d.localVersion} vs global ${d.globalVersion}) — the harness needs one instance; the fix relinks it onto the global copy`);
    }
    for (const d of blocked) {
      // Relinking here would cross a release line, so the profile itself has to
      // be reinstalled against the upgraded global tree.
      detail.push(`stale duplicate: ${d.name} (local ${d.localVersion} vs global ${d.globalVersion}) — a different release line, so this one cannot be relinked: reinstall the profile against the upgraded dsh`);
    }
    for (const s of scan.skipped) {
      // By-design retention (version differs, sharing would silently change the
      // dependency) — worded so an OK verdict cannot be misread as "found a
      // problem and did not fix it".
      detail.push(`kept as a local copy by design (versions differ, relinking would change the version): ${s.name} (local ${s.localVersion} vs global ${s.globalVersion})`);
    }

    const ok = scan.duplicates.length === 0 && scan.diverged.length === 0;
    const broken = scan.duplicates.length + scan.diverged.length;
    const summary = ok
      ? `${scan.linked.length} package(s) already shared with the global install`
        + (scan.skipped.length > 0
          ? `; ${scan.skipped.length} version-diverged package(s) kept as local copies by design`
          : '')
      : `${broken} package(s) loaded twice — presets will fail to mount`
        + (scan.diverged.length > 0
          ? `; ${scan.diverged.length} of them stale harness package(s) the global install has moved past`
          : '')
        + (blocked.length > 0
          ? `; ${blocked.length} cannot be relinked (different release line) and need a profile reinstall`
          : '');
    return {
      ok,
      summary,
      detail,
      findings,
      // Nothing left for `fix` to do when every finding needs a reinstall, so
      // the report must not promise a repair it cannot perform.
      ...(ok || findings.length > 0 ? {} : { fixable: false }),
    };
  },

  fix({ profileRoot }, findings) {
    const backupDir = backupDirFor(profileRoot);
    const result = linkDuplicates(findings, { backupDir });
    const versionOf = new Map(findings.map((f) => [f.name, f]));
    return {
      // A relinked stale copy changes the version the profile loads, so the
      // report names the move rather than only the package.
      fixed: result.applied.map((a) => {
        const entry = versionOf.get(a.name);
        return entry !== undefined && entry.localVersion !== entry.globalVersion
          ? `${a.name} (${entry.localVersion} → ${entry.globalVersion})`
          : a.name;
      }),
      failed: result.failed,
      note: `backup: ${backupDir}\n${restartNote()}`,
    };
  },

  undo({ profileRoot }) {
    const backupDir = latestBackup(profileRoot);
    if (backupDir === null) return { restored: [], failed: [] };
    const result = restore({ backupDir, profileRoot });
    return {
      restored: result.restored,
      failed: result.failed,
      note: `from ${backupDir}\n${restartNote()}`,
    };
  },
};
