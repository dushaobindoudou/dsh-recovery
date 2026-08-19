#!/usr/bin/env node
/**
 * `dsh-selfrepair` - the same diagnosis as `/doctor`, from a shell.
 *
 * This is the primary entry point, not a convenience: the duplicated-module
 * failure prevents every agent preset from mounting, which stops dsh from
 * reaching a prompt at all. A slash command is unreachable exactly when it is
 * most needed. It stays a standalone binary (`dsh doctor` spelled as
 * `dsh-selfrepair`) precisely so it works when dsh itself cannot start.
 *
 * Usage:
 *   dsh-selfrepair [status|fix|restore] [--fix] [--profile <name>] [--only <check-id>] [--json]
 *
 * `--fix` supplies the `fix` action when no positional action is given,
 * matching the `dsh doctor --fix` spelling. `restore` reverses the most recent
 * fix from the backup it left behind.
 */

import { checks } from '../lib/checks/index.js';
import { diagnose, repair, rollback, renderReport } from '../lib/doctor.js';
import { resolveGlobalRoot, resolveDshHome } from '../lib/paths.js';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
/** Flags that consume the following token as their value. */
const VALUE_FLAGS = new Set(['--profile', '--only']);
const positionalTokens = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    if (VALUE_FLAGS.has(argv[i])) i++; // skip the flag's value too
    continue;
  }
  positionalTokens.push(argv[i]);
}
const positional = positionalTokens[0];
const action = positional ?? (argv.includes('--fix') ? 'fix' : 'status');
const asJson = argv.includes('--json');
const profileFlag = argv.indexOf('--profile');
const onlyFlag = argv.indexOf('--only');
const only = onlyFlag >= 0 && argv[onlyFlag + 1] !== undefined ? [argv[onlyFlag + 1]] : undefined;
const dshHome = resolveDshHome();

if (!['status', 'fix', 'restore'].includes(action)) {
  console.error('Usage: dsh-selfrepair [status|fix|restore] [--fix] [--profile <name>] [--only <check-id>] [--json]');
  process.exit(2);
}

const globalRoot = resolveGlobalRoot();
if (globalRoot === null) {
  console.error('could not locate the global dsh install; set DSH_GLOBAL_ROOT');
  process.exit(1);
}

function profileNames() {
  if (profileFlag >= 0 && argv[profileFlag + 1] !== undefined) return [argv[profileFlag + 1]];
  const root = join(dshHome, 'profiles');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((n) => existsSync(join(root, n, 'package.json')));
}

const names = profileNames();
if (names.length === 0) {
  console.error(`no profiles found under ${join(dshHome, 'profiles')}`);
  process.exit(1);
}

const report = [];
let unhealthy = false;

for (const profile of names) {
  const env = { profileRoot: join(dshHome, 'profiles', profile), globalRoot, dshHome };
  if (action === 'restore') {
    const outcome = await rollback(checks, env, only === undefined ? {} : { only });
    report.push({ profile, undone: outcome.undone, results: outcome.results, healthy: outcome.healthy });
    if (!outcome.healthy) unhealthy = true;
    if (!asJson) {
      console.log(`=== ${profile} ===`);
      if (outcome.undone.length === 0) console.log('Nothing to restore - no backup from a previous fix.');
      for (const u of outcome.undone) {
        console.log(`restored: ${u.title}`);
        for (const r of u.restored) console.log(`  ${r}`);
        for (const f of u.failed) console.log(`  FAILED ${f.name}: ${f.error}`);
        if (u.note) for (const l of u.note.split('\n')) console.log(`  ${l}`);
      }
      console.log(renderReport({ results: outcome.results, healthy: outcome.healthy }, env));
      console.log('');
    }
  } else if (action === 'fix') {
    const outcome = await repair(checks, env, only === undefined ? {} : { only });
    report.push({ profile, applied: outcome.applied, results: outcome.results, healthy: outcome.healthyAfter });
    if (!outcome.healthyAfter) unhealthy = true;
    if (!asJson) {
      console.log(`=== ${profile} ===`);
      for (const a of outcome.applied) {
        console.log(`fixed: ${a.title}`);
        for (const f of a.fixed) console.log(`  ${f}`);
        for (const f of a.failed) console.log(`  FAILED ${f.name}: ${f.error}`);
        if (a.note) for (const l of a.note.split('\n')) console.log(`  ${l}`);
      }
      console.log(renderReport({ results: outcome.results, healthy: outcome.healthyAfter }, env));
      console.log('');
    }
  } else {
    const outcome = await diagnose(checks, env);
    report.push({ profile, results: outcome.results, healthy: outcome.healthy });
    if (!outcome.healthy) unhealthy = true;
    if (!asJson) {
      console.log(`=== ${profile} ===`);
      console.log(renderReport(outcome, env));
      console.log('');
    }
  }
}

if (asJson) console.log(JSON.stringify(report, null, 2));
process.exit(unhealthy ? 1 : 0);
