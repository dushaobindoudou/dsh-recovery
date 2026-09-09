import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

import { checks } from '../lib/checks/index.js';

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

/** Evaluate the bundle and return its exports, plus the CSS it injected. */
function evaluate() {
  const sb = sandbox();
  vm.runInNewContext(src, sb, { filename: 'lib/client.js' });
  // The bundle takes React from the host via `require`, exactly as the
  // first-party client plugins do; a stub is enough to evaluate the factory.
  const react = {
    createElement: (...args) => ({ type: args[0] }),
    useState: () => [null, () => {}],
    useEffect: () => {},
    useCallback: (f) => f,
    useMemo: (f) => f(),
  };
  const exports = sb.registered.factory((spec) => {
    if (spec === 'react') return react;
    throw new Error('unexpected require: ' + spec);
  });
  return { sb, exports, css: sb.styles.join('\n') };
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
    const { exports } = evaluate();
    // dsh's bundle contract: the factory returns `module.exports` itself, not
    // the module wrapper — see any @deepseek-ai/dsh-client-ui-* client.js.
    assert.equal(typeof exports.apply, 'function');
    // The bundle runs in a vm realm, so its Array has a different prototype;
    // copy into this realm before a strict structural comparison.
    assert.deepEqual([...exports.inject], ['connection', 'slots', 'locale']);
  });
});

describe('doctor page localization', () => {
  test('the zh and en dictionaries cover exactly the same keys', () => {
    // A key translated in one language and forgotten in the other renders as a
    // raw key id in the UI, which is the failure this asserts away.
    const { exports } = evaluate();
    const zhKeys = Object.keys(exports.locales.zh).sort();
    const enKeys = Object.keys(exports.locales.en).sort();
    assert.deepEqual(enKeys, zhKeys);
    assert.ok(zhKeys.length > 30, 'the page is fully translated, not partially');
  });

  test('no dictionary entry is left empty or untranslated between languages', () => {
    const { exports } = evaluate();
    const { zh, en } = exports.locales;
    for (const key of Object.keys(zh)) {
      assert.equal(typeof zh[key], 'string', key + ' must be a string');
      assert.equal(typeof en[key], 'string', key + ' must be a string');
      assert.ok(zh[key].length > 0 && en[key].length > 0, key + ' must not be empty');
    }
    assert.equal(zh.localeCode, 'zh');
    assert.equal(en.localeCode, 'en');
  });

  test('placeholders match between the two languages', () => {
    // `t('problemsFixable', {count, fixable})` must fill both slots in either
    // language; a dropped placeholder silently loses a number.
    const { exports } = evaluate();
    const { zh, en } = exports.locales;
    const slots = (text) => (text.match(/\{(\w+)\}/g) ?? []).sort().join(',');
    for (const key of Object.keys(zh)) {
      assert.equal(slots(en[key]), slots(zh[key]), 'placeholders differ for ' + key);
    }
  });

  test('every check has a localized card title', () => {
    const { exports } = evaluate();
    for (const check of checks) {
      const key = exports.checkTitleKeys[check.id];
      assert.ok(key !== undefined, 'no title key for check ' + check.id);
      assert.ok(exports.locales.zh[key] !== undefined, 'no zh title for ' + check.id);
      assert.ok(exports.locales.en[key] !== undefined, 'no en title for ' + check.id);
    }
  });

  test('no user-visible Han characters are hardcoded outside the dictionaries', () => {
    // Everything the reader sees has to come from a dictionary, or an English
    // reader gets a page in mixed languages.
    const withoutDictionaries = src.replace(/const zh = \{[\s\S]*?\n {4}\};/, '');
    const leaked = withoutDictionaries
      .split('\n')
      .filter((line) => /[一-鿿]/.test(line))
      // Comments explain the code and may be in either language.
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
    assert.deepEqual(leaked, []);
  });
});

describe('doctor page theming', () => {
  test('uses the host warning token that actually exists', () => {
    // The host defines `--dsw-alias-state-warn-primary`. The plausible-looking
    // `state-warning-primary` resolves to nothing, which silently erased the
    // warning dot and the card's accent border in both themes.
    const { css } = evaluate();
    assert.ok(css.includes('--dsw-alias-state-warn-primary'), 'warn token must be used');
    assert.ok(!css.includes('--dsw-alias-state-warning-primary'), 'state-warning-primary is not a host token');
  });

  test('text on a brand fill uses the token that flips with the theme', () => {
    // `--dsw-alias-brand-primary` is near-black in light mode and near-white in
    // dark mode, so a literal white label on it disappears in dark mode.
    const { css } = evaluate();
    const brandFilled = css.split('\n').filter((rule) => (
      // A rule that paints text on the brand fill. A brand-filled shape with no
      // label of its own (the AI dot) has no text color to get wrong.
      /background:\s*var\(--dsw-alias-brand-primary\)/.test(rule) && /(^|[;{])color:/.test(rule)
    ));
    assert.ok(brandFilled.length > 0, 'the page does put text on the brand color');
    for (const rule of brandFilled) {
      assert.ok(
        rule.includes('color:var(--dsw-alias-label-primary-foreground)'),
        'brand-filled rule must use the flipping label token: ' + rule,
      );
    }
  });

  test('every color comes from a host token, bar the one documented exception', () => {
    const { css } = evaluate();
    const literals = css.split('\n').filter((rule) => /#[0-9a-fA-F]{3,8}\b/.test(rule));
    // The success circle sits on a fixed green in both themes, so its glyph is
    // deliberately a literal white.
    assert.deepEqual(literals.map((r) => r.slice(0, 12)), ['.dc-ok-icon{']);
  });
});
