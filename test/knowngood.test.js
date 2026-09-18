import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  KNOWN_GOOD_DIR,
  snapshotFiles,
  recordKnownGood,
  latestKnownGood,
  readSnapshotManifest,
  rollbackToKnownGood,
} from '../lib/knowngood.js';

const GOOD = 'agent-default-model:\n  provider: liepin\n  model: glm-5-3-flash\n';
const BROKEN = 'agent-default-model:\n  provider: liepin\n  model: typo-model\n';

describe('known-good snapshots', () => {
  let tmp, env, settings, patch;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-known-good-'));
    const dshHome = join(tmp, 'home');
    const profileRoot = join(dshHome, 'profiles', 'web');
    const globalRoot = join(tmp, 'global');
    mkdirSync(profileRoot, { recursive: true });
    mkdirSync(globalRoot, { recursive: true });
    writeFileSync(join(globalRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.2-rc.1' }));
    env = { dshHome, profileRoot, globalRoot };
    settings = join(dshHome, 'settings.yaml');
    patch = join(profileRoot, 'cordis.patch.yml');
    writeFileSync(settings, GOOD);
    writeFileSync(patch, '- insert:\n    - id: plugin-selfrepair\n      name: dsh-recovery\n');
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test('records the config files and a manifest naming the dsh version', () => {
    const recorded = recordKnownGood(env);
    assert.deepEqual(recorded.files, ['settings.yaml', 'cordis.patch.yml']);
    assert.equal(recorded.reused, false);
    const manifest = readSnapshotManifest(recorded.dir);
    assert.equal(manifest.dshVersion, '0.1.2-rc.1');
    assert.equal(manifest.profile, 'web');
    assert.match(manifest.recordedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(readFileSync(join(recorded.dir, 'settings.yaml'), 'utf8'), GOOD);
  });

  test('never records the credential store', () => {
    // The tool reads credential key names and never their values; a snapshot
    // that copied the key store around would trade that away for convenience.
    writeFileSync(join(env.dshHome, '.credentials.yaml'), 'version: 1\nrefs:\n  FOO_API_KEY: secret\n');
    const recorded = recordKnownGood(env);
    assert.deepEqual(readdirSync(recorded.dir).sort(), ['cordis.patch.yml', 'manifest.json', 'settings.yaml']);
    assert.equal(snapshotFiles(env).some((f) => f.path.includes('.credentials')), false);
  });

  test('an unchanged configuration keeps its original snapshot', () => {
    const first = recordKnownGood(env, { now: new Date('2026-09-01T10:00:00Z') });
    const second = recordKnownGood(env, { now: new Date('2026-09-09T10:00:00Z') });
    assert.equal(second.reused, true);
    assert.equal(second.dir, first.dir);
    // So "known-good from <date>" names when the state last differed.
    assert.equal(readSnapshotManifest(second.dir).recordedAt, '2026-09-01T10:00:00.000Z');
  });

  test('a changed configuration records a new snapshot and prunes old ones', () => {
    for (let i = 0; i < 7; i += 1) {
      writeFileSync(settings, `${GOOD}# revision ${i}\n`);
      recordKnownGood(env, { now: new Date(Date.UTC(2026, 8, i + 1)), keep: 3 });
    }
    const dirs = readdirSync(join(env.profileRoot, KNOWN_GOOD_DIR, 'snapshots'));
    assert.equal(dirs.length, 3, 'only the newest are kept');
    assert.match(readFileSync(join(latestKnownGood(env.profileRoot), 'settings.yaml'), 'utf8'), /revision 6/);
  });

  test('records nothing when there is no configuration to record', () => {
    rmSync(settings);
    rmSync(patch);
    assert.equal(recordKnownGood(env), null);
    assert.equal(existsSync(join(env.profileRoot, KNOWN_GOOD_DIR)), false);
  });

  test('rollback puts the recorded configuration back and backs up what it replaced', () => {
    recordKnownGood(env);
    writeFileSync(settings, BROKEN);

    const outcome = rollbackToKnownGood(env);
    assert.deepEqual(outcome.restored, ['settings.yaml', 'cordis.patch.yml']);
    assert.equal(outcome.failed.length, 0);
    assert.equal(readFileSync(settings, 'utf8'), GOOD);
    // A rollback that could not itself be undone would be the one irreversible
    // write in the tool.
    assert.equal(readFileSync(join(outcome.backup, 'settings.yaml'), 'utf8'), BROKEN);
  });

  test('rollback recovers a settings.yaml that no longer parses', () => {
    // The case targeted repair cannot handle: the tool cannot know what the
    // broken YAML was meant to say, but it knows what it used to be.
    recordKnownGood(env);
    writeFileSync(settings, 'agent-default-model:\n  provider: [unclosed\n');
    rollbackToKnownGood(env);
    assert.equal(readFileSync(settings, 'utf8'), GOOD);
  });

  test('rollback with nothing on record reports that, and changes nothing', () => {
    writeFileSync(settings, BROKEN);
    const outcome = rollbackToKnownGood(env);
    assert.equal(outcome.from, null);
    assert.deepEqual(outcome.restored, []);
    assert.equal(readFileSync(settings, 'utf8'), BROKEN, 'no snapshot means no write');
  });

  test('a file absent when the snapshot was taken is not resurrected', () => {
    rmSync(patch);
    recordKnownGood(env);
    writeFileSync(patch, '- insert:\n    - id: added-later\n');
    const outcome = rollbackToKnownGood(env);
    assert.deepEqual(outcome.restored, ['settings.yaml']);
    assert.match(readFileSync(patch, 'utf8'), /added-later/, 'left alone, not deleted');
  });
});
