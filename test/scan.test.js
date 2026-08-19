import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanProfile } from '../lib/scan.js';
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
    assert.equal(r.skipped.length, 1);
    assert.equal(r.skipped[0].reason, 'version mismatch');
    assert.equal(r.skipped[0].localVersion, '1.0.0');
    assert.equal(r.skipped[0].globalVersion, '2.0.0');
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
    assert.deepEqual(r, { duplicates: [], skipped: [], linked: [] });
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
