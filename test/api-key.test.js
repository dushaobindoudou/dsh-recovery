import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apiKey, credentialsKeys } from '../lib/checks/api-key.js';

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
    // Pre-release flat layout: tolerated for older installs (see the
    // version-1 regression tests below for the layout dsh writes today).
    writeFileSync(join(tmp, '.credentials.yaml'), 'DSH_TEST_KEY_B: stored\n');
    const r = await apiKey.detect(env);
    assert.equal(r.ok, true);
  });

  test('a provider whose key is under the version-1 refs layout is ok', async () => {
    writeFileSync(join(tmp, 'settings.yaml'), providerText('DSH_TEST_KEY_A'));
    writeFileSync(
      join(tmp, '.credentials.yaml'),
      'version: 1\nrefs:\n  DSH_TEST_KEY_A: stored\n  OTHER_REF: stored\n',
    );
    const r = await apiKey.detect(env);
    assert.equal(r.ok, true);
  });

  test('a key present only under refs is found, not reported from the env', async () => {
    delete process.env.DSH_TEST_KEY_A;
    writeFileSync(join(tmp, 'settings.yaml'), providerText('DSH_TEST_KEY_A'));
    writeFileSync(join(tmp, '.credentials.yaml'), 'version: 1\nrefs:\n  DSH_TEST_KEY_A: stored\n');
    const r = await apiKey.detect(env);
    assert.equal(r.ok, true);
  });

  test('a version-1 document without the provider key is reported', async () => {
    writeFileSync(join(tmp, 'settings.yaml'), providerText('DSH_TEST_KEY_C'));
    writeFileSync(join(tmp, '.credentials.yaml'), 'version: 1\nrefs:\n  UNRELATED_KEY: stored\n');
    const r = await apiKey.detect(env);
    assert.equal(r.ok, false);
    assert.deepEqual(r.findings, ['vol']);
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

describe('credentialsKeys', () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-apikey-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test('returns the refs keys of a version-1 document', () => {
    writeFileSync(join(tmp, '.credentials.yaml'), 'version: 1\nrefs:\n  VOL_API_KEY: x\n  LIEPIN_API_KEY: x\n');
    const keys = credentialsKeys(tmp);
    assert.deepEqual([...keys].sort(), ['LIEPIN_API_KEY', 'VOL_API_KEY']);
  });

  test('a version-1 document with no refs yields an empty set, never ["version","refs"]', () => {
    writeFileSync(join(tmp, '.credentials.yaml'), 'version: 1\n');
    assert.deepEqual([...credentialsKeys(tmp)], []);
  });

  test('top-level layout keys never leak into the set', () => {
    writeFileSync(
      join(tmp, '.credentials.yaml'),
      'version: 1\nrefs:\n  A: x\nrecords:\n  r1:\n    kind: env\n',
    );
    const keys = credentialsKeys(tmp);
    assert.ok(keys.has('A'));
    assert.ok(!keys.has('version'));
    assert.ok(!keys.has('refs'));
    assert.ok(!keys.has('records'));
  });

  test('tolerates the pre-release flat layout', () => {
    writeFileSync(join(tmp, '.credentials.yaml'), 'DSH_TEST_KEY_B: stored\n');
    assert.deepEqual([...credentialsKeys(tmp)], ['DSH_TEST_KEY_B']);
  });

  test('a missing file yields an empty set', () => {
    assert.deepEqual([...credentialsKeys(tmp)], []);
  });
});
