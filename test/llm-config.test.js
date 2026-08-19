import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findConfigProblems, stripProblems } from '../lib/checks/llm-config.js';

// The exact shape that broke this machine: a stray override on top of the
// built-in deepseek provider defaults.
const BROKEN = `ui-onboarding:
  welcomeNoticeVersion: 2026-08-13.1
llm-pi-ai:
  providers:
    vol:
      baseURL: https://ark.cn-beijing.volces.com/api/coding/v3
      models:
        - id: doubao-pro-128k-240515
llm-deepseek:
  baseURL: "11111"
  models: []
agent-default-model:
  provider: liepin
  model: glm-5-3
`;

describe('findConfigProblems', () => {
  test('flags a non-URL baseURL and an emptied model list', () => {
    const p = findConfigProblems(BROKEN);
    assert.equal(p.length, 2);
    assert.deepEqual(p.map((x) => x.kind).sort(), ['baseURL', 'models']);
    assert.equal(p[0].block, 'llm-deepseek');
    assert.match(p[0].why, /not an http\(s\) URL/);
  });

  test('never touches a provider block with a real providers: tree', () => {
    // `llm-pi-ai` holds the user's actual provider definitions; rewriting it
    // would destroy hand-written config.
    const p = findConfigProblems(BROKEN);
    assert.ok(p.every((x) => x.block !== 'llm-pi-ai'));
  });

  test('accepts a healthy override', () => {
    const good = 'llm-deepseek:\n  baseURL: https://api.deepseek.com\n';
    assert.deepEqual(findConfigProblems(good), []);
  });

  test('flags an empty baseURL', () => {
    const p = findConfigProblems('llm-x:\n  baseURL: ""\n');
    assert.equal(p.length, 1);
    assert.equal(p[0].why, 'empty');
  });

  test('returns nothing for a file with no llm blocks', () => {
    assert.deepEqual(findConfigProblems('locale:\n  preference: zh\n'), []);
  });
});

describe('stripProblems', () => {
  test('removes the block entirely when all its keys are unusable', () => {
    // Dropping the whole block is what restores the built-in default; leaving
    // an empty `llm-deepseek:` behind would still shadow it.
    const out = stripProblems(BROKEN, findConfigProblems(BROKEN));
    assert.ok(!out.includes('llm-deepseek'));
    assert.ok(!out.includes('11111'));
  });

  test('keeps every unrelated line byte-for-byte', () => {
    const out = stripProblems(BROKEN, findConfigProblems(BROKEN));
    assert.ok(out.includes('welcomeNoticeVersion: 2026-08-13.1'));
    assert.ok(out.includes('https://ark.cn-beijing.volces.com/api/coding/v3'));
    assert.ok(out.includes('provider: liepin'));
    assert.ok(out.includes('    vol:'));
  });

  test('keeps the block when only one of several keys is bad', () => {
    const mixed = 'llm-x:\n  baseURL: "11111"\n  timeout: 30\n';
    const out = stripProblems(mixed, findConfigProblems(mixed));
    assert.ok(out.includes('llm-x:'));
    assert.ok(out.includes('timeout: 30'));
    assert.ok(!out.includes('11111'));
  });

  test('is a no-op when there are no problems', () => {
    const clean = 'locale:\n  preference: zh\n';
    assert.equal(stripProblems(clean, []), clean);
  });
});
