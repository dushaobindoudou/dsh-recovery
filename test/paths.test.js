import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveGlobalRoot, resolveProfileRoot, backupDirFor, latestBackup, profileFromArgv } from '../lib/paths.js';

describe('resolveGlobalRoot', () => {
  test('env override wins', () => {
    assert.equal(resolveGlobalRoot({ DSH_GLOBAL_ROOT: '/opt/dsh' }, [], '/usr/bin/node'), '/opt/dsh');
  });

  test('finds the install by walking up from the dsh bin', () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-paths-')));
    try {
      const install = join(tmp, 'lib', 'node_modules', '@deepseek-ai', 'dsh');
      mkdirSync(join(install, 'lib'), { recursive: true });
      writeFileSync(join(install, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh' }));
      const bin = join(install, 'lib', 'bin.js');
      writeFileSync(bin, '');
      assert.equal(resolveGlobalRoot({}, ['node', bin], '/usr/bin/node'), install);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('falls back to the interpreter prefix when argv[1] is not dsh', () => {
    // This is the standalone-CLI path: argv[1] is the script, not the dsh bin.
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-paths-')));
    try {
      const prefix = join(tmp, 'prefix');
      const install = join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh');
      mkdirSync(install, { recursive: true });
      writeFileSync(join(install, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh' }));
      mkdirSync(join(prefix, 'bin'), { recursive: true });
      const node = join(prefix, 'bin', 'node');
      writeFileSync(node, '');
      assert.equal(resolveGlobalRoot({}, ['node', '/somewhere/else/cli.js'], node), install);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('returns null when nothing resolves', () => {
    assert.equal(resolveGlobalRoot({}, ['node', '/nope/missing.js'], '/nope/bin/node'), null);
  });
});

describe('resolveProfileRoot', () => {
  test('env override wins', () => {
    assert.equal(resolveProfileRoot(import.meta.url, { DSH_PROFILE_ROOT: '/p' }), '/p');
  });

  test('returns null when no ancestor declares dsh.profile', () => {
    // This repo's own manifest has no `dsh.profile`, so walking up finds nothing.
    assert.equal(resolveProfileRoot(import.meta.url, {}), null);
  });
});

describe('backup helpers', () => {
  test('backupDirFor is timestamped and filesystem-safe', () => {
    const dir = backupDirFor('/p', new Date('2026-08-18T10:20:30.400Z'));
    assert.equal(dir, '/p/.dsh-doctor-backup/2026-08-18T10-20-30-400Z');
    assert.ok(!dir.includes(':'), 'colons would be illegal on some filesystems');
  });

  test('latestBackup returns null when none exist, newest otherwise', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-bk-'));
    try {
      assert.equal(latestBackup(tmp), null);
      const root = join(tmp, '.dsh-doctor-backup');
      mkdirSync(join(root, '2026-01-01T00-00-00-000Z'), { recursive: true });
      mkdirSync(join(root, '2026-08-18T00-00-00-000Z'), { recursive: true });
      assert.equal(latestBackup(tmp), join(root, '2026-08-18T00-00-00-000Z'));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('profileFromArgv (symlinked development installs)', () => {
  // When the package is symlinked in from a workspace, import.meta.url resolves
  // outside the profile, so the booted profile has to come from the command line.
  let tmp, dshHome;

  const setup = () => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-argv-'));
    dshHome = join(tmp, 'home');
    for (const p of ['web', 'acp']) {
      mkdirSync(join(dshHome, 'profiles', p), { recursive: true });
      writeFileSync(join(dshHome, 'profiles', p, 'package.json'), '{}');
    }
  };

  test('resolves the `dsh <alias>` subcommand form', () => {
    setup();
    try {
      assert.equal(profileFromArgv(['node', 'dsh', 'web', '--port', '0'], dshHome), join(dshHome, 'profiles', 'web'));
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  test('resolves the explicit --profile flag', () => {
    setup();
    try {
      assert.equal(profileFromArgv(['node', 'dsh', '--profile', 'acp'], dshHome), join(dshHome, 'profiles', 'acp'));
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  test('ignores a positional that is not a profile', () => {
    setup();
    try {
      assert.equal(profileFromArgv(['node', 'dsh', 'plugin', 'add', 'web'], dshHome), null,
        'only the first positional is considered, and `plugin` is not a profile');
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });

  test('returns null with no profile on the command line', () => {
    setup();
    try {
      assert.equal(profileFromArgv(['node', 'dsh'], dshHome), null);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
});
