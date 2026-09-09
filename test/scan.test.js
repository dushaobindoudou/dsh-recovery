import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanProfile, sameReleaseLine } from '../lib/scan.js';
import { linkDuplicates, restore } from '../lib/repair.js';

/** Build a package dir with a manifest. */
function pkg(root, name, version) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }));
  return dir;
}

describe('scanProfile', () => {
  let tmp, profileRoot, globalRoot, localNM, globalNM;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-doctor-'));
    profileRoot = join(tmp, 'profile');
    globalRoot = join(tmp, 'global');
    localNM = join(profileRoot, 'node_modules');
    globalNM = join(globalRoot, 'node_modules');
    mkdirSync(localNM, { recursive: true });
    mkdirSync(globalNM, { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test('flags a real copy whose version matches the global one', () => {
    pkg(globalNM, 'left-pad', '1.0.0');
    pkg(localNM, 'left-pad', '1.0.0');
    const r = scanProfile({ profileRoot, globalRoot });
    assert.equal(r.duplicates.length, 1);
    assert.equal(r.duplicates[0].name, 'left-pad');
    assert.equal(r.skipped.length, 0);
  });

  test('refuses to relink when versions differ', () => {
    // Relinking here would silently swap the dependency the plugin was built
    // against, so it must be reported rather than "fixed".
    pkg(globalNM, 'left-pad', '2.0.0');
    pkg(localNM, 'left-pad', '1.0.0');
    const r = scanProfile({ profileRoot, globalRoot });
    assert.equal(r.duplicates.length, 0);
    assert.equal(r.diverged.length, 0);
    assert.equal(r.skipped.length, 1);
    assert.equal(r.skipped[0].reason, 'version mismatch');
    assert.equal(r.skipped[0].localVersion, '1.0.0');
    assert.equal(r.skipped[0].globalVersion, '2.0.0');
  });

  test('a stale harness copy after a dsh upgrade is diverged, not by-design', () => {
    // The exact post-upgrade state: the global tree moved on, the profile kept
    // the copy its lockfile pins. Two cordis instances is the failure this tool
    // exists for, whatever the version numbers say.
    pkg(globalNM, '@deepseek-ai/cordis', '4.0.2');
    pkg(localNM, '@deepseek-ai/cordis', '4.0.1');
    const r = scanProfile({ profileRoot, globalRoot });
    assert.equal(r.duplicates.length, 0);
    assert.equal(r.skipped.length, 0, 'never filed as by-design retention');
    assert.equal(r.diverged.length, 1);
    assert.equal(r.diverged[0].name, '@deepseek-ai/cordis');
    assert.equal(r.diverged[0].localVersion, '4.0.1');
    assert.equal(r.diverged[0].globalVersion, '4.0.2');
    assert.equal(r.diverged[0].relinkable, true);
  });

  test('a 0.x harness copy is relinkable inside its minor, not across it', () => {
    // The harness ships its whole tree as one 0.1.x prerelease line, so the
    // minor is what a caret would treat as the major.
    pkg(globalNM, '@deepseek-ai/dsh-scope', '0.1.2-rc.1');
    pkg(localNM, '@deepseek-ai/dsh-scope', '0.1.1-rc.2');
    pkg(globalNM, '@deepseek-ai/dsh-llm', '0.2.0-rc.1');
    pkg(localNM, '@deepseek-ai/dsh-llm', '0.1.1-rc.2');
    const r = scanProfile({ profileRoot, globalRoot });
    const byName = Object.fromEntries(r.diverged.map((d) => [d.name, d]));
    assert.equal(r.diverged.length, 2);
    assert.equal(byName['@deepseek-ai/dsh-scope'].relinkable, true);
    assert.equal(byName['@deepseek-ai/dsh-llm'].relinkable, false);
  });

  test('a harness copy from another major is reported but not relinkable', () => {
    pkg(globalNM, '@deepseek-ai/cordis', '4.0.2');
    pkg(localNM, '@deepseek-ai/cordis', '3.9.0');
    const r = scanProfile({ profileRoot, globalRoot });
    assert.equal(r.diverged.length, 1);
    assert.equal(r.diverged[0].relinkable, false);
  });

  test('an unparsable version is never silently relinked', () => {
    pkg(globalNM, '@deepseek-ai/cordis', '4.0.2');
    pkg(localNM, '@deepseek-ai/cordis', 'workspace');
    const r = scanProfile({ profileRoot, globalRoot });
    assert.equal(r.diverged.length, 1);
    assert.equal(r.diverged[0].relinkable, false);
  });

  test('treats an existing symlink as already done', () => {
    const g = pkg(globalNM, 'left-pad', '1.0.0');
    symlinkSync(g, join(localNM, 'left-pad'));
    const r = scanProfile({ profileRoot, globalRoot });
    assert.equal(r.duplicates.length, 0);
    assert.equal(r.linked.length, 1);
  });

  test('ignores packages the global install does not have', () => {
    // The plugin the user actually installed lives only in the profile and must
    // never be touched.
    pkg(localNM, 'dsh-acp-server', '0.6.1');
    const r = scanProfile({ profileRoot, globalRoot });
    assert.equal(r.duplicates.length, 0);
    assert.equal(r.skipped.length, 0);
    assert.equal(r.linked.length, 0);
  });

  test('handles scoped packages one level deep', () => {
    pkg(globalNM, '@deepseek-ai/cordis', '4.0.1');
    pkg(localNM, '@deepseek-ai/cordis', '4.0.1');
    const r = scanProfile({ profileRoot, globalRoot });
    assert.equal(r.duplicates.length, 1);
    assert.equal(r.duplicates[0].name, '@deepseek-ai/cordis');
  });

  test('returns empty results for a profile with no node_modules', () => {
    const bare = join(tmp, 'bare');
    mkdirSync(bare, { recursive: true });
    const r = scanProfile({ profileRoot: bare, globalRoot });
    assert.deepEqual(r, { duplicates: [], diverged: [], skipped: [], linked: [] });
  });
});

describe('sameReleaseLine', () => {
  test('holds inside a line and breaks across one', () => {
    assert.equal(sameReleaseLine('4.0.1', '4.0.2'), true);
    assert.equal(sameReleaseLine('1.0.2', '1.0.3'), true);
    assert.equal(sameReleaseLine('0.1.0-rc.7', '0.1.2-rc.1'), true);
    assert.equal(sameReleaseLine('3.9.0', '4.0.2'), false);
    assert.equal(sameReleaseLine('0.1.1-rc.2', '0.2.0-rc.1'), false);
  });

  test('an unreadable version is never treated as the same line', () => {
    assert.equal(sameReleaseLine(null, '4.0.2'), false);
    assert.equal(sameReleaseLine('4.0.1', null), false);
    assert.equal(sameReleaseLine('link:../elsewhere', '4.0.2'), false);
  });
});

describe('linkDuplicates / restore', () => {
  let tmp, profileRoot, globalRoot, localNM, globalNM;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-doctor-'));
    profileRoot = join(tmp, 'profile');
    globalRoot = join(tmp, 'global');
    localNM = join(profileRoot, 'node_modules');
    globalNM = join(globalRoot, 'node_modules');
    mkdirSync(localNM, { recursive: true });
    mkdirSync(globalNM, { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test('replaces the copy with a symlink that resolves to the global path', () => {
    // This is the property the whole tool exists for: one real path means one
    // ESM module instance means one dependency-injection system.
    const g = pkg(globalNM, '@deepseek-ai/cordis', '4.0.1');
    pkg(localNM, '@deepseek-ai/cordis', '4.0.1');
    const { duplicates } = scanProfile({ profileRoot, globalRoot });
    const backupDir = join(tmp, 'backup');
    const res = linkDuplicates(duplicates, { backupDir });

    assert.equal(res.failed.length, 0);
    assert.equal(res.applied.length, 1);
    const localPath = join(localNM, '@deepseek-ai/cordis');
    assert.equal(realpathSync(localPath), realpathSync(g));
  });

  test('dryRun reports without touching the filesystem', () => {
    pkg(globalNM, 'left-pad', '1.0.0');
    pkg(localNM, 'left-pad', '1.0.0');
    const { duplicates } = scanProfile({ profileRoot, globalRoot });
    const res = linkDuplicates(duplicates, { backupDir: join(tmp, 'backup'), dryRun: true });
    assert.equal(res.applied[0].action, 'would link');
    // Still a real copy, not a link.
    const after = scanProfile({ profileRoot, globalRoot });
    assert.equal(after.duplicates.length, 1);
    assert.equal(after.linked.length, 0);
  });

  test('restore puts the original copies back', () => {
    pkg(globalNM, '@deepseek-ai/cordis', '4.0.1');
    pkg(localNM, '@deepseek-ai/cordis', '4.0.1');
    const backupDir = join(tmp, 'backup');
    linkDuplicates(scanProfile({ profileRoot, globalRoot }).duplicates, { backupDir });
    assert.equal(scanProfile({ profileRoot, globalRoot }).linked.length, 1);

    const res = restore({ backupDir, profileRoot });
    assert.equal(res.failed.length, 0);
    assert.deepEqual(res.restored, ['@deepseek-ai/cordis']);
    const after = scanProfile({ profileRoot, globalRoot });
    assert.equal(after.duplicates.length, 1, 'a real copy is back');
    assert.equal(after.linked.length, 0);
  });

  test('relinks a stale harness copy onto the global version, reversibly', () => {
    const g = pkg(globalNM, '@deepseek-ai/cordis', '4.0.2');
    pkg(localNM, '@deepseek-ai/cordis', '4.0.1');
    const backupDir = join(tmp, 'backup');
    const { diverged } = scanProfile({ profileRoot, globalRoot });

    const res = linkDuplicates(diverged, { backupDir });
    assert.equal(res.failed.length, 0);
    assert.equal(realpathSync(join(localNM, '@deepseek-ai/cordis')), realpathSync(g));
    assert.equal(scanProfile({ profileRoot, globalRoot }).linked.length, 1);

    // The version move is undoable like any other fix: the 4.0.1 copy comes back.
    restore({ backupDir, profileRoot });
    const after = scanProfile({ profileRoot, globalRoot });
    assert.equal(after.linked.length, 0);
    assert.equal(after.diverged.length, 1);
    assert.equal(after.diverged[0].localVersion, '4.0.1');
  });

  test('is idempotent: a second run finds nothing to do', () => {
    pkg(globalNM, 'left-pad', '1.0.0');
    pkg(localNM, 'left-pad', '1.0.0');
    linkDuplicates(scanProfile({ profileRoot, globalRoot }).duplicates, { backupDir: join(tmp, 'b1') });
    const second = scanProfile({ profileRoot, globalRoot });
    assert.equal(second.duplicates.length, 0);
    const res = linkDuplicates(second.duplicates, { backupDir: join(tmp, 'b2') });
    assert.equal(res.applied.length, 0);
  });
});
