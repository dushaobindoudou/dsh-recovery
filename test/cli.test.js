/**
 * The standalone binary, driven the way a user drives it.
 *
 * These run the real process against a synthetic `$DSH_HOME` because the CLI's
 * contract is more than its functions: the action words, the exit code a health
 * check reads, and — since `dsh doctor` routes here — whether `doctor` actually
 * leaves the installation usable rather than only describing it.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/selfrepair.js', import.meta.url));

/** Build a package dir with a manifest. */
function pkg(root, name, version) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }));
  return dir;
}

describe('dsh-selfrepair CLI', () => {
  let tmp, dshHome, globalRoot, profileNM;

  /** Run the binary against the fixture installation. */
  function run(...args) {
    return spawnSync(process.execPath, [BIN, ...args], {
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: dshHome, DSH_GLOBAL_ROOT: globalRoot },
    });
  }

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-cli-'));
    dshHome = join(tmp, 'home');
    globalRoot = join(tmp, 'global');
    const profileRoot = join(dshHome, 'profiles', 'web');
    profileNM = join(profileRoot, 'node_modules');
    mkdirSync(profileNM, { recursive: true });
    mkdirSync(join(globalRoot, 'node_modules'), { recursive: true });
    writeFileSync(join(profileRoot, 'package.json'), JSON.stringify({ name: 'dsh-profile-web', dsh: { profile: { bundles: [] } } }));
    writeFileSync(join(globalRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.2-rc.1' }));
    // The post-upgrade shape: the global tree moved on, the profile did not.
    pkg(join(globalRoot, 'node_modules'), '@deepseek-ai/cordis', '4.0.2');
    pkg(profileNM, '@deepseek-ai/cordis', '4.0.1');
    pkg(join(globalRoot, 'node_modules'), 'zod', '4.5.4');
    pkg(profileNM, 'zod', '3.25.76');
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test('status reports the split and exits 1, without writing', () => {
    const r = run('status');
    assert.equal(r.status, 1, 'a health check reads the exit code');
    assert.match(r.stdout, /\[FAIL\] Profile packages duplicating the global dsh install/);
    assert.match(r.stdout, /stale duplicate: @deepseek-ai\/cordis \(local 4\.0\.1 vs global 4\.0\.2\)/);
    assert.equal(lstatSync(join(profileNM, '@deepseek-ai/cordis')).isSymbolicLink(), false, 'status never writes');
  });

  test('doctor repairs the installation and exits 0', () => {
    // The whole point of the `dsh doctor` spelling: one command, and the
    // installation is usable again.
    const r = run('doctor');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /@deepseek-ai\/cordis \(4\.0\.1 → 4\.0\.2\)/);
    assert.match(r.stdout, /Restart dsh for this to take effect/);
    assert.match(r.stdout, /No problems found\./);
    assert.equal(lstatSync(join(profileNM, '@deepseek-ai/cordis')).isSymbolicLink(), true);
    // An ordinary library keeps its own version.
    assert.equal(lstatSync(join(profileNM, 'zod')).isSymbolicLink(), false);
  });

  test('doctor on a healthy install changes nothing and says so', () => {
    run('doctor');
    const r = run('doctor');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Nothing to fix\./);
  });

  test('restore reverses what doctor did', () => {
    run('doctor');
    const r = run('restore');
    assert.equal(r.status, 1, 'the split is back, so the install is unhealthy again');
    assert.match(r.stdout, /restored: Profile packages duplicating/);
    assert.equal(lstatSync(join(profileNM, '@deepseek-ai/cordis')).isSymbolicLink(), false);
  });

  test('--json stays machine-readable for every action', () => {
    const r = run('status', '--json');
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].profile, 'web');
    const check = parsed[0].results.find((c) => c.id === 'duplicate-modules');
    assert.equal(check.ok, false);
    assert.deepEqual(check.findings.map((f) => f.name), ['@deepseek-ai/cordis']);
  });

  test('an unknown action is a usage error, not a repair', () => {
    const r = run('repair-everything');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Usage: dsh-selfrepair \[doctor\|status\|fix\|restore\|rollback\]/);
    assert.equal(lstatSync(join(profileNM, '@deepseek-ai/cordis')).isSymbolicLink(), false);
  });

  test('a healthy doctor run records the configuration, and rollback puts it back', () => {
    // The whole cycle a user lives through: configure, confirm it works, break
    // it, and get the working state back — including the breakage no targeted
    // repair can undo, because the tool cannot know what the config was meant
    // to say.
    const settings = join(dshHome, 'settings.yaml');
    const good = 'llm-pi-ai:\n  providers:\n    liepin:\n      api: openai-completions\n      baseURL: https://example.invalid/v1\n      models:\n        - id: m1\n          name: m1\n';
    writeFileSync(settings, good);

    const recorded = run('doctor');
    assert.equal(recorded.status, 0, recorded.stdout + recorded.stderr);
    assert.match(recorded.stdout, /recorded this configuration as known-good: settings\.yaml/);

    // Break it the way an editing accident does: the file no longer parses.
    writeFileSync(settings, 'llm-pi-ai:\n  providers: [unclosed\n');
    const broken = run('status');
    assert.equal(broken.status, 1);
    assert.match(broken.stdout, /settings\.yaml is valid YAML/);
    assert.match(broken.stdout, /A known-good configuration from .* is on record — `dsh doctor rollback` puts it back\./);

    const rolled = run('rollback');
    assert.equal(rolled.status, 0, rolled.stdout + rolled.stderr);
    assert.match(rolled.stdout, /rolled back to the configuration recorded/);
    assert.match(rolled.stdout, /settings\.yaml lives in the dsh home and is shared by every profile\./);
    assert.equal(readFileSync(settings, 'utf8'), good);
    assert.match(rolled.stdout, /No problems found\./);
  });

  test('rollback without a recorded configuration says so instead of guessing', () => {
    const r = run('rollback');
    assert.match(r.stdout, /No known-good configuration on record/);
  });

  test('--help lists doctor as the repair action', () => {
    const r = run('--help');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /doctor\s+diagnose and repair/);
    assert.match(r.stdout, /status\s+report only, never writes/);
  });
});
