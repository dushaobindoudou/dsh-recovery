import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checks } from '../lib/checks/index.js';
import { diagnose, repair, renderReport } from '../lib/doctor.js';

function pkg(root, name, version) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }));
}

describe('doctor end-to-end on a reproduced broken install', () => {
  let tmp, env;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-doctor-'));
    const dshHome = join(tmp, 'home');
    const profileRoot = join(dshHome, 'profiles', 'web');
    const globalRoot = join(tmp, 'global');
    mkdirSync(join(profileRoot, 'node_modules'), { recursive: true });
    mkdirSync(join(globalRoot, 'node_modules'), { recursive: true });
    // Failure 1: cordis duplicated into the profile.
    pkg(join(globalRoot, 'node_modules'), '@deepseek-ai/cordis', '4.0.1');
    pkg(join(profileRoot, 'node_modules'), '@deepseek-ai/cordis', '4.0.1');
    // Failure 2: a stray override shadowing the built-in deepseek defaults.
    writeFileSync(join(dshHome, 'settings.yaml'),
      'locale:\n  preference: zh\nllm-deepseek:\n  baseURL: "11111"\n  models: []\n');
    env = { profileRoot, globalRoot, dshHome };
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test('diagnose finds both failures among five checks', async () => {
    const report = await diagnose(checks, env);
    assert.equal(report.healthy, false);
    assert.equal(report.results.length, 5);
    const broken = report.results.filter((r) => !r.ok);
    assert.deepEqual(broken.map((r) => r.id).sort(), ['duplicate-modules', 'llm-config']);
    assert.ok(broken.every((r) => r.fixable === true));
    // The file-shape checks pass on a minimal but valid settings.yaml.
    assert.ok(report.results.find((r) => r.id === 'settings-yaml').ok);
    assert.ok(report.results.find((r) => r.id === 'agent-default-model').ok);
    assert.ok(report.results.find((r) => r.id === 'api-key').ok);
  });

  test('diagnose does not modify anything', async () => {
    const before = readFileSync(join(env.dshHome, 'settings.yaml'), 'utf8');
    await diagnose(checks, env);
    assert.equal(readFileSync(join(env.dshHome, 'settings.yaml'), 'utf8'), before);
  });

  test('repair fixes both and reports healthy afterwards', async () => {
    const outcome = await repair(checks, env);
    assert.equal(outcome.healthyAfter, true, 'install is healthy after repair');
    assert.equal(outcome.applied.length, 2);
    assert.ok(outcome.applied.every((a) => a.failed.length === 0));
    // The bad override is gone; unrelated config survives.
    const after = readFileSync(join(env.dshHome, 'settings.yaml'), 'utf8');
    assert.ok(!after.includes('11111'));
    assert.ok(after.includes('preference: zh'));
  });

  test('repair is idempotent', async () => {
    await repair(checks, env);
    const second = await repair(checks, env);
    assert.equal(second.applied.length, 0);
    assert.equal(second.healthyAfter, true);
  });

  test('only:[] restricts which checks are repaired', async () => {
    const outcome = await repair(checks, env, { only: ['llm-config'] });
    assert.deepEqual(outcome.applied.map((a) => a.id), ['llm-config']);
    // The other failure is untouched and still reported.
    assert.equal(outcome.healthyAfter, false);
  });

  test('a throwing check is reported, not fatal', async () => {
    const exploding = {
      id: 'boom', title: 'Exploding check', severity: 'critical', fixable: false,
      detect() { throw new Error('probe failed'); },
    };
    const report = await diagnose([exploding, ...checks], env);
    const boom = report.results.find((r) => r.id === 'boom');
    assert.equal(boom.ok, false);
    assert.match(boom.summary, /probe failed/);
    // The real checks still ran.
    assert.equal(report.results.length, 6);
  });

  test('renderReport marks failures and points at the fix', async () => {
    const text = renderReport(await diagnose(checks, env), env);
    assert.match(text, /\[FAIL\]/);
    assert.match(text, /fixable/);
    assert.match(text, /doctor fix/);
  });

  test('a healthy install renders no problems', async () => {
    await repair(checks, env);
    const text = renderReport(await diagnose(checks, env), env);
    assert.match(text, /No problems found/);
    assert.ok(!text.includes('[FAIL]'));
  });
});
