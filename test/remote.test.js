import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installDoctorRemote, aiCapability } from '../lib/remote.js';

function pkg(root, pkgName, version) {
  const dir = join(root, pkgName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkgName, version }));
}

describe('doctor Remote (settings-page channel)', () => {
  let tmp, dshHome, profileRoot, globalRoot, remote;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-remote-'));
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
    const provided = [];
    remote = installDoctorRemote({
      reflect: { provide(name, svc) { provided.push([name, svc]); } },
    });
    assert.equal(provided.length, 1);
    assert.equal(provided[0][0], 'doctor');
  });
  afterEach(() => {
    delete process.env.DSH_PROFILE_ROOT;
    delete process.env.DSH_GLOBAL_ROOT;
    delete process.env.DSH_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  test('installs nothing when ctx is not a Cordis context', () => {
    assert.equal(installDoctorRemote({}), null);
    assert.equal(installDoctorRemote(undefined), null);
  });

  test('status reports healthy for a clean install', async () => {
    const r = await remote.status(null);
    assert.equal(r.healthy, true);
    assert.equal(r.results.length, 5);
    assert.equal(r.env.profileRoot, profileRoot);
  });

  test('status finds the two fixable failures', async () => {
    pkg(join(globalRoot, 'node_modules'), '@deepseek-ai/cordis', '4.0.1');
    pkg(join(profileRoot, 'node_modules'), '@deepseek-ai/cordis', '4.0.1');
    writeFileSync(join(dshHome, 'settings.yaml'), 'llm-deepseek:\n  baseURL: "11111"\n');
    const r = await remote.status(null);
    assert.equal(r.healthy, false);
    assert.deepEqual(r.results.filter((x) => !x.ok).map((x) => x.id).sort(), ['duplicate-modules', 'llm-config']);
  });

  test('fix repairs and re-reports healthy', async () => {
    pkg(join(globalRoot, 'node_modules'), '@deepseek-ai/cordis', '4.0.1');
    pkg(join(profileRoot, 'node_modules'), '@deepseek-ai/cordis', '4.0.1');
    writeFileSync(join(dshHome, 'settings.yaml'), 'llm-deepseek:\n  baseURL: "11111"\n');
    const r = await remote.fix(null);
    assert.equal(r.healthyAfter, true);
    assert.equal(r.applied.length, 2);
  });

  test('fix respects the only: restriction', async () => {
    pkg(join(globalRoot, 'node_modules'), '@deepseek-ai/cordis', '4.0.1');
    pkg(join(profileRoot, 'node_modules'), '@deepseek-ai/cordis', '4.0.1');
    writeFileSync(join(dshHome, 'settings.yaml'), 'llm-deepseek:\n  baseURL: "11111"\n');
    const r = await remote.fix({ only: ['llm-config'] });
    assert.deepEqual(r.applied.map((a) => a.id), ['llm-config']);
    assert.equal(r.healthyAfter, false);
  });

  test('info lists every check with its metadata', async () => {
    const r = await remote.info(null);
    assert.equal(r.error, null);
    assert.equal(r.checks.length, 5);
    assert.ok(r.checks.every((c) => typeof c.id === 'string' && typeof c.fixable === 'boolean'));
    assert.equal(r.env.profileRoot, profileRoot);
  });

  test('methods return only JSON-safe plain data', async () => {
    const r = await remote.status(null);
    const roundTripped = JSON.parse(JSON.stringify(r));
    assert.deepEqual(roundTripped, r);
  });

  test('status defaults to rules mode and reports AI capability', async () => {
    const r = await remote.status(null);
    assert.equal(r.mode, 'rules');
    assert.equal(r.ai.available, false); // the mock context has no services
    assert.ok(typeof r.ai.reason === 'string' && r.ai.reason.length > 0);
  });

  test('info reports AI capability', async () => {
    const r = await remote.info(null);
    assert.equal(r.ai.available, false);
  });

  test('status ai mode falls back to rules with a reason when AI is unavailable', async () => {
    const r = await remote.status({ mode: 'ai' });
    assert.equal(r.mode, 'ai');
    assert.equal(r.ai.available, false);
    assert.ok(typeof r.ai.reason === 'string' && r.ai.reason.length > 0);
    assert.equal(r.healthy, true); // the rule checks still ran
  });

  test('status ai mode runs the model and returns its analysis when available', async () => {
    const llm = {
      listProviders() { return [{ provider: 'vol' }]; },
      stream() {
        return (async function* () {
          yield { type: 'text-delta', index: 0, text: '快照显示' };
          yield { type: 'text-delta', index: 0, text: '一切正常。' };
          yield { type: 'finish', reason: { kind: 'stop' } };
        })();
      },
    };
    const aiCtx = {
      reflect: { provide() {} },
      get(name) {
        if (name === 'llm') return llm;
        if (name === 'agentDefaultModel') {
          return { currentSelection() { return { provider: 'vol', model: 'deepseek-v4-flash-260425' }; } };
        }
        return undefined;
      },
    };
    const aiRemote = installDoctorRemote(aiCtx);
    const r = await aiRemote.status({ mode: 'ai' });
    assert.equal(r.mode, 'ai');
    assert.equal(r.ai.available, true);
    assert.equal(r.ai.provider, 'vol');
    assert.equal(r.ai.analysis, '快照显示一切正常。');
    assert.equal(r.healthy, true);
  });

  test('status ai mode reports a model-stream failure as an error, keeping rule results', async () => {
    const llm = {
      listProviders() { return [{ provider: 'vol' }]; },
      stream() {
        return (async function* () {
          yield { type: 'finish', reason: { kind: 'error', failure: { message: 'boom' } } };
        })();
      },
    };
    const aiCtx = {
      reflect: { provide() {} },
      get(name) {
        if (name === 'llm') return llm;
        if (name === 'agentDefaultModel') {
          return { currentSelection() { return { provider: 'vol', model: 'm' }; } };
        }
        return undefined;
      },
    };
    const aiRemote = installDoctorRemote(aiCtx);
    const r = await aiRemote.status({ mode: 'ai' });
    assert.equal(r.ai.available, true);
    assert.equal(r.ai.error, 'boom');
    assert.equal(r.healthy, true); // rules unaffected by the model failure
  });

  test('aiCapability reports unavailable when the provider has no adapter', async () => {
    const aiCtx = {
      reflect: { provide() {} },
      get(name) {
        if (name === 'llm') return { listProviders() { return []; } };
        if (name === 'agentDefaultModel') {
          return { currentSelection() { return { provider: 'vol', model: 'm' }; } };
        }
        return undefined;
      },
    };
    const cap = aiCapability(aiCtx);
    assert.equal(cap.available, false);
    assert.ok(cap.reason.includes('vol'));
  });
});
