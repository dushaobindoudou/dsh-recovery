/**
 * Tests for the broken-links check: dangling link:/file: dependency targets,
 * dangling node_modules symlinks, unresolvable patch rows, and the clean case.
 *
 * @module tests/broken-links
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { brokenLinks } from '../lib/checks/broken-links.js';

test('broken-links: clean profile passes', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-brokenlinks-'));
  try {
    const profileRoot = join(tmp, 'profile');
    mkdirSync(join(profileRoot, 'node_modules', 'dsh-thing'), { recursive: true });
    writeFileSync(join(profileRoot, 'package.json'), JSON.stringify({ dependencies: { 'dsh-thing': '^1.0.0' } }));
    const r = brokenLinks.detect({ profileRoot });
    assert.equal(r.ok, true);
    assert.deepEqual(r.findings, []);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('broken-links: dangling link: dependency target is reported', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-brokenlinks-'));
  try {
    const profileRoot = join(tmp, 'profile');
    mkdirSync(profileRoot, { recursive: true });
    writeFileSync(join(profileRoot, 'package.json'), JSON.stringify({
      dependencies: { 'dsh-refine': 'link:/nonexistent/checkout/dsh-refine' },
    }));
    const r = brokenLinks.detect({ profileRoot });
    assert.equal(r.ok, false);
    const f = r.findings.find((x) => x.kind === 'dep-path');
    assert.ok(f);
    assert.equal(f.name, 'dsh-refine');
    assert.equal(f.target, '/nonexistent/checkout/dsh-refine');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('broken-links: dangling node_modules symlink (incl. fallback chains) is reported', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-brokenlinks-'));
  try {
    const profileRoot = join(tmp, 'profile');
    mkdirSync(join(profileRoot, 'node_modules'), { recursive: true });
    // Two-hop chain ending at a missing path — existsSync resolves it all.
    const fallbackDir = join(profileRoot, '.dsh-module-fallback', 'node_modules');
    mkdirSync(fallbackDir, { recursive: true });
    symlinkSync('/nonexistent/checkout/pkg', join(fallbackDir, 'dsh-continual-harness'));
    symlinkSync(join(fallbackDir, 'dsh-continual-harness'), join(profileRoot, 'node_modules', 'dsh-continual-harness'));
    const r = brokenLinks.detect({ profileRoot });
    assert.equal(r.ok, false);
    const f = r.findings.find((x) => x.kind === 'dangling-symlink');
    assert.ok(f);
    assert.equal(f.name, 'dsh-continual-harness');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('broken-links: unresolvable patch row is reported; resolvable one is not', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-brokenlinks-'));
  try {
    const profileRoot = join(tmp, 'profile');
    mkdirSync(join(profileRoot, 'node_modules', 'dsh-present'), { recursive: true });
    writeFileSync(join(profileRoot, 'node_modules', 'dsh-present', 'package.json'), JSON.stringify({ name: 'dsh-present', version: '1.0.0' }));
    writeFileSync(join(profileRoot, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: row-a',
      '      name: dsh-present',
      '    - id: row-b',
      '      name: dsh-missing',
    ].join('\n'));
    const r = brokenLinks.detect({ profileRoot });
    assert.equal(r.ok, false);
    const unresolvable = r.findings.filter((x) => x.kind === 'bundle-unresolvable').map((x) => x.name);
    assert.deepEqual(unresolvable, ['dsh-missing']);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
