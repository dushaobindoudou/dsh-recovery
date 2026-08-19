import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apiKey } from '../lib/checks/api-key.js';

describe('api-key check', () => {
  let tmp, env;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-apikey-'));
    env = { profileRoot: join(tmp, 'p'), globalRoot: join(tmp, 'g'), dshHome: tmp };
  });
  afterEach(() => {
    delete process.env.DSH_TEST_KEY_A;
    delete process.env.DSH_TEST_KEY_B;
    rmSync(tmp, { recursive: true, force: true });
  });

  const providerText = (apiKeyEnv) =>
    'llm-pi-ai:\n  providers:\n    vol:\n      apiKeyEnv: ' + apiKeyEnv + '\n      models:\n        - id: m1\n';

  test('a provider whose key is in the environment is ok', async () => {
    process.env.DSH_TEST_KEY_A = 'secret';
    writeFileSync(join(tmp, 'settings.yaml'), providerText('DSH_TEST_KEY_A'));
    const r = await apiKey.detect(env);
    assert.equal(r.ok, true);
  });

  test('a provider whose key is in the credentials store is ok', async () => {
    writeFileSync(join(tmp, 'settings.yaml'), providerText('DSH_TEST_KEY_B'));
    writeFileSync(join(tmp, '.credentials.yaml'), 'DSH_TEST_KEY_B: stored\n');
    const r = await apiKey.detect(env);
    assert.equal(r.ok, true);
  });

  test('a provider with a key in neither place is reported', async () => {
    writeFileSync(join(tmp, 'settings.yaml'), providerText('DSH_TEST_KEY_C'));
    const r = await apiKey.detect(env);
    assert.equal(r.ok, false);
    assert.match(r.summary, /no API key anywhere/);
    assert.deepEqual(r.findings, ['vol']);
  });

  test('a provider without apiKeyEnv is skipped', async () => {
    writeFileSync(join(tmp, 'settings.yaml'), 'llm-deepseek:\n  baseURL: https://api.example.com\n  models: [m1]\n');
    const r = await apiKey.detect(env);
    assert.equal(r.ok, true);
  });

  test('missing settings.yaml is ok', async () => {
    const r = await apiKey.detect(env);
    assert.equal(r.ok, true);
  });
});
