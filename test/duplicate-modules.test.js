import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { duplicateModules } from '../lib/checks/duplicate-modules.js';

/** Build a package dir with a manifest. */
function pkg(root, name, version) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }));
  return dir;
}

describe('duplicate-modules check', () => {
  let tmp, profileRoot, globalRoot, localNM, globalNM;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-dupmod-'));
    profileRoot = join(tmp, 'profile');
    globalRoot = join(tmp, 'global');
    localNM = join(profileRoot, 'node_modules');
    globalNM = join(globalRoot, 'node_modules');
    mkdirSync(localNM, { recursive: true });
    mkdirSync(globalNM, { recursive: true });
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test('a clean install is OK with no detail noise', () => {
    pkg(globalNM, 'left-pad', '1.0.0');
    rmSync(join(localNM, 'left-pad'), { recursive: true, force: true });
    symlinkSync(join(globalNM, 'left-pad'), join(localNM, 'left-pad'));
    const r = duplicateModules.detect({ profileRoot, globalRoot });
    assert.equal(r.ok, true);
    assert.deepEqual(r.detail, []);
    assert.match(r.summary, /already shared with the global install$/);
  });

  test('an OK verdict with a version-diverged package says so, unambiguously', () => {
    pkg(globalNM, 'zod', '4.4.3');
    pkg(localNM, 'zod', '3.25.76');
    const r = duplicateModules.detect({ profileRoot, globalRoot });
    assert.equal(r.ok, true);
    // The summary itself carries the "by design" clause…
    assert.match(r.summary, /already shared with the global install/);
    assert.match(r.summary, /1 version-diverged package\(s\) kept as local copies by design/);
    // …and the detail line explains WHY it is kept, not just "left alone".
    assert.equal(r.detail.length, 1);
    assert.match(r.detail[0], /^kept as a local copy by design/);
    assert.match(r.detail[0], /zod/);
    assert.match(r.detail[0], /3\.25\.76/);
    assert.doesNotMatch(r.detail[0], /left alone/);
    assert.deepEqual(r.findings, []);
  });

  test('a stale harness copy left by a dsh upgrade is a FAIL, not an OK', () => {
    // The regression this check was blind to: after `dsh` moves to a new
    // release every profile-local `@deepseek-ai/*` copy diverges, which used to
    // land in the by-design bucket and report "No problems found" while every
    // preset was one restart away from failing to mount.
    pkg(globalNM, '@deepseek-ai/cordis', '4.0.2');
    pkg(localNM, '@deepseek-ai/cordis', '4.0.1');
    const r = duplicateModules.detect({ profileRoot, globalRoot });
    assert.equal(r.ok, false);
    assert.deepEqual(r.findings.map((f) => f.name), ['@deepseek-ai/cordis']);
    assert.match(r.summary, /1 package\(s\) loaded twice/);
    assert.match(r.summary, /stale harness package/);
    assert.equal(r.detail.length, 1);
    assert.match(r.detail[0], /^stale duplicate: @deepseek-ai\/cordis \(local 4\.0\.1 vs global 4\.0\.2\)/);
    assert.doesNotMatch(r.detail[0], /by design/);
    assert.equal(r.fixable, undefined, 'the check-level fixable flag stands');
  });

  test('a stale harness copy from another release line is reported, but not offered as fixable', () => {
    pkg(globalNM, '@deepseek-ai/cordis', '4.0.2');
    pkg(localNM, '@deepseek-ai/cordis', '3.9.0');
    const r = duplicateModules.detect({ profileRoot, globalRoot });
    assert.equal(r.ok, false);
    assert.deepEqual(r.findings, [], 'relinking across a release line is not a repair this tool makes');
    assert.equal(r.fixable, false);
    assert.match(r.summary, /cannot be relinked \(different release line\)/);
    assert.match(r.detail[0], /reinstall the profile against the upgraded dsh/);
  });

  test('a third-party version difference is still OK next to a stale harness copy', () => {
    pkg(globalNM, 'zod', '4.4.3');
    pkg(localNM, 'zod', '3.25.76');
    pkg(globalNM, '@deepseek-ai/dsh-scope', '0.1.2-rc.1');
    pkg(localNM, '@deepseek-ai/dsh-scope', '0.1.1-rc.2');
    const r = duplicateModules.detect({ profileRoot, globalRoot });
    assert.equal(r.ok, false);
    assert.deepEqual(r.findings.map((f) => f.name), ['@deepseek-ai/dsh-scope']);
    // zod keeps its by-design line; only the harness package is a problem.
    const zodLine = r.detail.find((d) => d.includes('zod'));
    assert.match(zodLine, /^kept as a local copy by design/);
  });

  test('real duplicates stay a FAIL', () => {
    pkg(globalNM, 'left-pad', '1.0.0');
    pkg(localNM, 'left-pad', '1.0.0');
    const r = duplicateModules.detect({ profileRoot, globalRoot });
    assert.equal(r.ok, false);
    assert.deepEqual(r.findings.map((f) => f.name), ['left-pad']);
  });

  test('fix names the running dsh processes that still hold stale copies', () => {
    pkg(globalNM, 'left-pad', '1.0.0');
    const local = pkg(localNM, 'left-pad', '1.0.0');
    const scan = duplicateModules.detect({ profileRoot, globalRoot });
    const r = duplicateModules.fix({ profileRoot }, scan.findings);
    assert.deepEqual(r.fixed, ['left-pad']);
    assert.match(r.note, /Restart dsh for this to take effect/);
    // The replaced path is now a symlink to the global copy.
    assert.equal(lstatSync(local).isSymbolicLink(), true);
  });

  test('fix names the version move it made for a stale harness copy', () => {
    pkg(globalNM, '@deepseek-ai/cordis', '4.0.2');
    const local = pkg(localNM, '@deepseek-ai/cordis', '4.0.1');
    const scan = duplicateModules.detect({ profileRoot, globalRoot });
    const r = duplicateModules.fix({ profileRoot }, scan.findings);
    // Relinking moves the profile onto the global version; that is a change the
    // user has to be able to see in the report.
    assert.deepEqual(r.fixed, ['@deepseek-ai/cordis (4.0.1 → 4.0.2)']);
    assert.equal(lstatSync(local).isSymbolicLink(), true);
    assert.equal(duplicateModules.detect({ profileRoot, globalRoot }).ok, true);
  });

  test('undo puts the stale copy back and the check fails again', () => {
    pkg(globalNM, '@deepseek-ai/cordis', '4.0.2');
    pkg(localNM, '@deepseek-ai/cordis', '4.0.1');
    const scan = duplicateModules.detect({ profileRoot, globalRoot });
    duplicateModules.fix({ profileRoot }, scan.findings);

    const undone = duplicateModules.undo({ profileRoot });
    assert.deepEqual(undone.restored, ['@deepseek-ai/cordis']);
    assert.equal(undone.failed.length, 0);
    const after = duplicateModules.detect({ profileRoot, globalRoot });
    assert.equal(after.ok, false);
    assert.match(after.detail[0], /local 4\.0\.1 vs global 4\.0\.2/);
  });
});
