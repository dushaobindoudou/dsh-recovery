import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execute, apply, name, inject, bootCheck } from '../lib/index.js';

function pkg(root, pkgName, version) {
  const dir = join(root, pkgName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkgName, version }));
}

describe('/doctor command', () => {
  let tmp, dshHome, profileRoot, globalRoot;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-doctor-cmd-'));
    dshHome = join(tmp, 'home');
    profileRoot = join(dshHome, 'profiles', 'web');
    globalRoot = join(tmp, 'global');
    mkdirSync(join(profileRoot, 'node_modules'), { recursive: true });
    mkdirSync(join(globalRoot, 'node_modules'), { recursive: true });
    writeFileSync(join(profileRoot, 'package.json'), JSON.stringify({ name: 'p', dsh: { profile: {} } }));
    writeFileSync(join(dshHome, 'settings.yaml'), 'locale:\n  preference: zh\n');
    // Roots are normally discovered from the running process; these overrides
    // make the command testable without booting dsh.
    process.env.DSH_PROFILE_ROOT = profileRoot;
    process.env.DSH_GLOBAL_ROOT = globalRoot;
    process.env.DSH_HOME = dshHome;
  });
  afterEach(() => {
    delete process.env.DSH_PROFILE_ROOT;
    delete process.env.DSH_GLOBAL_ROOT;
    delete process.env.DSH_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  const invoke = (rawInput) => execute({ rawInput });

  test('rejects an unknown argument with usage', async () => {
    const r = await invoke('frobnicate');
    assert.equal(r.kind, 'error');
    assert.match(r.text, /Usage: \/doctor/);
  });

  test('reports a healthy install', async () => {
    const r = await invoke('');
    assert.equal(r.kind, 'success');
    assert.match(r.text, /No problems found/);
  });

  test('status reports both failures without changing anything', async () => {
    pkg(join(globalRoot, 'node_modules'), '@deepseek-ai/cordis', '4.0.1');
    pkg(join(profileRoot, 'node_modules'), '@deepseek-ai/cordis', '4.0.1');
    writeFileSync(join(dshHome, 'settings.yaml'), 'llm-deepseek:\n  baseURL: "11111"\n');
    const before = readFileSync(join(dshHome, 'settings.yaml'), 'utf8');

    const r = await invoke('status');
    assert.match(r.text, /\[FAIL\] Profile packages duplicating/);
    assert.match(r.text, /\[FAIL\] Unusable model configuration/);
    assert.equal(readFileSync(join(dshHome, 'settings.yaml'), 'utf8'), before);
  });

  test('fix repairs both and then reports healthy', async () => {
    pkg(join(globalRoot, 'node_modules'), '@deepseek-ai/cordis', '4.0.1');
    pkg(join(profileRoot, 'node_modules'), '@deepseek-ai/cordis', '4.0.1');
    writeFileSync(join(dshHome, 'settings.yaml'), 'locale:\n  preference: zh\nllm-deepseek:\n  baseURL: "11111"\n');

    const r = await invoke('fix');
    assert.equal(r.kind, 'success');
    assert.match(r.text, /No problems found/);
    assert.match(r.text, /Restart dsh/);
    const after = readFileSync(join(dshHome, 'settings.yaml'), 'utf8');
    assert.ok(!after.includes('11111'));
    assert.ok(after.includes('preference: zh'), 'unrelated settings survive');
  });

  test('fix on a healthy install does nothing', async () => {
    const r = await invoke('fix');
    assert.match(r.text, /Nothing to fix/);
  });

  test('exposes the cordis plugin contract', () => {
    assert.equal(name, 'command-doctor');
    assert.deepEqual(inject, ['commands']);
    let registered = null;
    const ctx = {
      effect(gen) { for (const _ of gen()) { /* drain */ } },
      commands: { register(spec) { registered = spec; return () => {}; } },
    };
    apply(ctx);
    assert.equal(registered.name, 'doctor');
    assert.equal(typeof registered.handler, 'function');
  });
});

describe('bootCheck', () => {
  let tmp, dshHome, profileRoot, globalRoot;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-boot-'));
    dshHome = join(tmp, 'home');
    profileRoot = join(dshHome, 'profiles', 'web');
    globalRoot = join(tmp, 'global');
    mkdirSync(join(profileRoot, 'node_modules'), { recursive: true });
    mkdirSync(join(globalRoot, 'node_modules'), { recursive: true });
    writeFileSync(join(profileRoot, 'package.json'), JSON.stringify({ name: 'p', dsh: { profile: {} } }));
    writeFileSync(join(dshHome, 'settings.yaml'), 'locale:\n  preference: zh\n');
    process.env.DSH_PROFILE_ROOT = profileRoot;
    process.env.DSH_GLOBAL_ROOT = globalRoot;
    process.env.DSH_HOME = dshHome;
  });
  afterEach(() => {
    delete process.env.DSH_PROFILE_ROOT;
    delete process.env.DSH_GLOBAL_ROOT;
    delete process.env.DSH_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  test('stays silent on a healthy install', async () => {
    const lines = [];
    const out = await bootCheck({ warn: (m) => lines.push(m) });
    assert.equal(out.healthy, true);
    assert.deepEqual(lines, []);
  });

  test('names the cause and the fix when broken', async () => {
    pkg(join(globalRoot, 'node_modules'), '@deepseek-ai/cordis', '4.0.1');
    pkg(join(profileRoot, 'node_modules'), '@deepseek-ai/cordis', '4.0.1');
    const lines = [];
    const out = await bootCheck({ warn: (m) => lines.push(m) });
    assert.equal(out.healthy, false);
    assert.deepEqual(out.broken, ['duplicate-modules']);
    assert.match(lines.join('\n'), /duplicating the global dsh install/);
    assert.match(lines.join('\n'), /doctor fix/);
  });

  test('never throws when the environment cannot be resolved', async () => {
    delete process.env.DSH_PROFILE_ROOT;
    delete process.env.DSH_GLOBAL_ROOT;
    // A diagnostic must not be able to break the boot it is diagnosing.
    const out = await bootCheck({ warn: () => { throw new Error('should not be reached'); } });
    assert.equal(out.ran, false);
    assert.ok(typeof out.reason === 'string');
  });
});

describe('/doctor restore', () => {
  let tmp, dshHome, profileRoot, globalRoot;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-restore-'));
    dshHome = join(tmp, 'home');
    profileRoot = join(dshHome, 'profiles', 'web');
    globalRoot = join(tmp, 'global');
    mkdirSync(join(profileRoot, 'node_modules'), { recursive: true });
    mkdirSync(join(globalRoot, 'node_modules'), { recursive: true });
    writeFileSync(join(profileRoot, 'package.json'), JSON.stringify({ name: 'p', dsh: { profile: {} } }));
    process.env.DSH_PROFILE_ROOT = profileRoot;
    process.env.DSH_GLOBAL_ROOT = globalRoot;
    process.env.DSH_HOME = dshHome;
  });
  afterEach(() => {
    delete process.env.DSH_PROFILE_ROOT;
    delete process.env.DSH_GLOBAL_ROOT;
    delete process.env.DSH_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  test('says so when there is nothing to restore', async () => {
    writeFileSync(join(dshHome, 'settings.yaml'), 'locale:\n  preference: zh\n');
    const r = await execute({ rawInput: 'restore' });
    assert.match(r.text, /Nothing to restore/);
  });

  test('rolls back a config fix, bringing the original file back', async () => {
    const original = 'locale:\n  preference: zh\nllm-deepseek:\n  baseURL: "11111"\n';
    writeFileSync(join(dshHome, 'settings.yaml'), original);
    await execute({ rawInput: 'fix' });
    assert.ok(!readFileSync(join(dshHome, 'settings.yaml'), 'utf8').includes('11111'));

    const r = await execute({ rawInput: 'restore' });
    assert.match(r.text, /restored/);
    // The undo is a real undo: the file is byte-identical to before the fix.
    assert.equal(readFileSync(join(dshHome, 'settings.yaml'), 'utf8'), original);
  });

  test('rolls back a module fix, restoring the real copies', async () => {
    pkg(join(globalRoot, 'node_modules'), '@deepseek-ai/cordis', '4.0.1');
    pkg(join(profileRoot, 'node_modules'), '@deepseek-ai/cordis', '4.0.1');
    writeFileSync(join(dshHome, 'settings.yaml'), 'locale:\n  preference: zh\n');

    await execute({ rawInput: 'fix' });
    const linked = await execute({ rawInput: 'status' });
    assert.match(linked.text, /already shared with the global install/);

    await execute({ rawInput: 'restore' });
    const after = await execute({ rawInput: 'status' });
    // Back to a duplicated real copy, which is what the fix had replaced.
    assert.match(after.text, /\[FAIL\] Profile packages duplicating/);
  });
});
