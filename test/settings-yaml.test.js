import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { settingsYaml, parseSettingsYaml } from '../lib/checks/settings-yaml.js';

describe('settings-yaml check', () => {
  let tmp, env;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dsh-syaml-'));
    env = { profileRoot: join(tmp, 'p'), globalRoot: join(tmp, 'g'), dshHome: tmp };
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const write = (text) => writeFileSync(join(tmp, 'settings.yaml'), text);

  test('a missing file is not a problem', async () => {
    const r = await settingsYaml.detect(env);
    assert.equal(r.ok, true);
  });

  test('valid YAML with a provider tree is ok', async () => {
    write('locale:\n  preference: zh\nllm-pi-ai:\n  providers:\n    vol:\n      models:\n        - id: m1\n');
    const r = await settingsYaml.detect(env);
    assert.equal(r.ok, true);
  });

  test('unparsable YAML is reported', async () => {
    write('llm-deepseek:\n  baseURL: "x"\n   oops: [unclosed\n');
    const r = await settingsYaml.detect(env);
    assert.equal(r.ok, false);
    assert.match(r.summary, /cannot be parsed/);
  });

  test('a top-level llm-* block that is not a mapping is reported', async () => {
    write('llm-deepseek: just-a-string\n');
    const r = await settingsYaml.detect(env);
    assert.equal(r.ok, false);
    assert.match(r.detail[0], /llm-deepseek/);
  });

  test('a scalar agent-default-model is reported', async () => {
    write('agent-default-model: broken\n');
    const r = await settingsYaml.detect(env);
    assert.equal(r.ok, false);
    assert.match(r.detail[0], /agent-default-model/);
  });

  test('parseSettingsYaml never throws', () => {
    assert.deepEqual(parseSettingsYaml('locale:\n  preference: zh'), { value: { locale: { preference: 'zh' } } });
    assert.ok(parseSettingsYaml('a: [').error !== undefined);
  });
});
