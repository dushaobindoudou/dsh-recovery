/**
 * Check: profile-local packages duplicating the global dsh install.
 *
 * See `../scan.js` for why this breaks preset mounting. In short: two real
 * copies of `@deepseek-ai/cordis` are two dependency-injection systems, so an
 * agent preset's persona row cannot see its agent scope and fails with
 * `prompt section "deployment:persona" is already registered`.
 *
 * @module checks/duplicate-modules
 */

import { scanProfile } from '../scan.js';
import { linkDuplicates, restore } from '../repair.js';
import { backupDirFor, latestBackup } from '../paths.js';

export const duplicateModules = {
  id: 'duplicate-modules',
  title: 'Profile packages duplicating the global dsh install',
  severity: 'critical',
  fixable: true,

  detect({ profileRoot, globalRoot }) {
    const scan = scanProfile({ profileRoot, globalRoot });
    const detail = [];
    for (const d of scan.duplicates) detail.push(`duplicate: ${d.name}@${d.localVersion}`);
    for (const s of scan.skipped) {
      detail.push(`left alone: ${s.name} (local ${s.localVersion} vs global ${s.globalVersion})`);
    }
    const ok = scan.duplicates.length === 0;
    return {
      ok,
      summary: ok
        ? `${scan.linked.length} package(s) already shared with the global install`
        : `${scan.duplicates.length} package(s) loaded twice — presets will fail to mount`,
      detail,
      findings: scan.duplicates,
    };
  },

  fix({ profileRoot }, findings) {
    const backupDir = backupDirFor(profileRoot);
    const result = linkDuplicates(findings, { backupDir });
    return {
      fixed: result.applied.map((a) => a.name),
      failed: result.failed,
      note: `backup: ${backupDir}\nRestart dsh for this to take effect.`,
    };
  },

  undo({ profileRoot }) {
    const backupDir = latestBackup(profileRoot);
    if (backupDir === null) return { restored: [], failed: [] };
    const result = restore({ backupDir, profileRoot });
    return {
      restored: result.restored,
      failed: result.failed,
      note: `from ${backupDir}\nRestart dsh for this to take effect.`,
    };
  },
};
