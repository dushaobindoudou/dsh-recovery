import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { agentDefaultModel } from '../lib/checks/agent-default-model.js';

describe('agent-default-model check', () => {
  let tmp, env;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-adm-'));
    env = { profileRoot: join(tmp, 'p'), globalRoot: join(tmp, 'g'), dshHome: tmp };
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const write = (text) => writeFileSync(join(tmp, 'settings.yaml'), text);
  const withProvider = (volModels, adm) =>
    'llm-pi-ai:\n  providers:\n    vol:\n      models:\n' + volModels.map((m) => `        - id: ${m}\n`).join('') +
    'agent-default-model:\n  provider: vol\n  model: ' + (adm === null ? 'null' : adm) + '\n';

  test('absent default model is ok', async () => {
    write('locale:\n  preference: zh\n');
    const r = await agentDefaultModel.detect(env);
    assert.equal(r.ok, true);
  });

  test('a model present in the provider list is ok', async () => {
    write(withProvider(['m1', 'm2'], 'm2'));
    const r = await agentDefaultModel.detect(env);
    assert.equal(r.ok, true);
    assert.match(r.summary, /vol\/m2/);
  });

  test('a model missing from the provider list is reported', async () => {
    write(withProvider(['m1'], 'nope'));
    const r = await agentDefaultModel.detect(env);
    assert.equal(r.ok, false);
    assert.match(r.summary, /"nope"/);
  });

  test('a provider that is not user-configured is left alone', async () => {
    // `deepseek` may be a built-in catalog entry; we cannot disprove it.
    write('agent-default-model:\n  provider: deepseek\n  model: deepseek-v4-flash\n');
    const r = await agentDefaultModel.detect(env);
    assert.equal(r.ok, true);
    assert.match(r.summary, /built-in/);
  });

  test('a missing provider is reported', async () => {
    write('agent-default-model:\n  model: m1\n');
    const r = await agentDefaultModel.detect(env);
    assert.equal(r.ok, false);
    assert.match(r.summary, /missing a provider/);
  });

  test('a configured provider with no selected model is reported', async () => {
    write('llm-pi-ai:\n  providers:\n    vol:\n      models:\n        - id: m1\nagent-default-model:\n  provider: vol\n');
    const r = await agentDefaultModel.detect(env);
    assert.equal(r.ok, false);
    assert.match(r.summary, /no model is selected/);
  });

  test('a non-mapping block is reported', async () => {
    write('agent-default-model: broken\n');
    const r = await agentDefaultModel.detect(env);
    assert.equal(r.ok, false);
  });
});
