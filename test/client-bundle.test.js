import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8');

/** A minimal browser-ish sandbox: enough for the bundle to parse and register. */
function sandbox() {
  const sb = { registered: null, styles: [] };
  sb.window = {
    __ModuleLoader__: { load: (handoff) => { sb.registered = handoff; } },
  };
  sb.document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, set textContent(v) { sb.styles.push(v); } }),
    head: { appendChild: () => {} },
  };
  sb.setTimeout = () => 0;
  sb.clearTimeout = () => {};
  return sb;
}

describe('doctor client bundle', () => {
  test('registers itself through __ModuleLoader__.load', () => {
    const sb = sandbox();
    vm.runInNewContext(src, sb, { filename: 'lib/client.js' });
    assert.ok(sb.registered, 'bundle must call window.__ModuleLoader__.load');
    assert.equal(sb.registered.id, 'dsh-selfrepair');
    assert.equal(typeof sb.registered.factory, 'function');
  });

  test('the factory evaluates and exposes the cordis plugin contract', () => {
    const sb = sandbox();
    vm.runInNewContext(src, sb, { filename: 'lib/client.js' });
    // dsh's bundle contract: the factory returns `module.exports` itself, not
    // the module wrapper — see any @deepseek-ai/dsh-client-ui-* client.js.
    // The bundle takes React from the host via `require`, exactly as the
    // first-party client plugins do; a stub is enough to evaluate the factory.
    const react = { createElement: (...args) => ({ type: args[0] }), useState: () => [null, () => {}], useEffect: () => {}, useCallback: (f) => f };
    const mod = sb.registered.factory((spec) => {
      if (spec === 'react') return react;
      throw new Error('unexpected require: ' + spec);
    });
    assert.equal(typeof mod.apply, 'function');
    // The bundle runs in a vm realm, so its Array has a different prototype;
    // copy into this realm before a strict structural comparison.
    assert.deepEqual([...mod.inject], ['connection', 'slots']);
  });
});
