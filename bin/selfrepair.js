#!/usr/bin/env node
/**
 * `dsh-selfrepair` (aliases: `dsh-selfrepair doctor`, `dsh-doctor`, and the
 * `dsh doctor` subcommand) - the same diagnosis as `/doctor`, from a shell.
 *
 * This is the primary entry point, not a convenience: the duplicated-module
 * failure prevents every agent preset from mounting, which stops dsh from
 * reaching a prompt at all. A slash command is unreachable exactly when it is
 * most needed. It stays a standalone binary precisely so it works when dsh
 * itself cannot start.
 *
 * Usage:
 *   dsh-selfrepair [doctor|status|fix|restore|rollback] [--fix] [--profile <name>] [--only <check-id>] [--json]
 *
 * `doctor` is the one-command repair — the spelling `dsh doctor` routes to —
 * and is an alias for `fix`: diagnose, apply every fixable repair, and report
 * what is left. It is the action to reach for when dsh is broken, which is why
 * it does not stop at a report. `status` is the read-only counterpart, the
 * no-argument default, and never writes. `--fix` supplies the `fix` action when
 * no positional action is given.
 *
 * Two different undos, because they answer different questions. `restore`
 * reverses *this tool's* most recent fix from the backup it left behind.
 * `rollback` puts back the last configuration the installation was known to be
 * healthy with, whoever broke it since — recorded by a `doctor` run that ended
 * healthy (see `../lib/knowngood.js`).
 */

import { checks } from '../lib/checks/index.js';
import { diagnose, repair, rollback, renderReport } from '../lib/doctor.js';
import { rollbackToKnownGood } from '../lib/knowngood.js';
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
const USAGE = [
  'Usage: dsh-selfrepair [doctor|status|fix|restore|rollback] [--fix] [--profile <name>] [--only <check-id>] [--json]',
  '',
  '  doctor   diagnose and repair (alias of fix) — the one command that restores a usable install',
  '  status   report only, never writes (the default with no action)',
  '  fix      apply every fixable repair, backing up what it touches',
  '  restore  reverse the most recent fix from its backup',
  '  rollback put the last known-good configuration back (recorded by a healthy doctor run)',
].join('\n');
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

const positional = positionalTokens[0];
const requested = positional ?? (argv.includes('--fix') ? 'fix' : 'status');
/**
 * `doctor` is an alias for `fix`: the command reached for when dsh is broken
 * has to leave it working, not print a diagnosis. Every repair backs up what it
 * touches and `restore` reverses it, so the write stays undoable.
 */
const action = requested === 'doctor' ? 'fix' : requested;
const asJson = argv.includes('--json');
const profileFlag = argv.indexOf('--profile');
const onlyFlag = argv.indexOf('--only');
const only = onlyFlag >= 0 && argv[onlyFlag + 1] !== undefined ? [argv[onlyFlag + 1]] : undefined;
const dshHome = resolveDshHome();

if (!['status', 'fix', 'restore', 'rollback'].includes(action)) {
  console.error(USAGE);
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
  if (action === 'rollback') {
    const outcome = rollbackToKnownGood(env);
    const after = await diagnose(checks, env);
    report.push({ profile, rolledBack: outcome, results: after.results, healthy: after.healthy });
    if (!after.healthy) unhealthy = true;
    if (!asJson) {
      console.log(`=== ${profile} ===`);
      if (outcome.from === null) {
        console.log('No known-good configuration on record — run `dsh doctor` once while the install is healthy to record one.');
      } else {
        console.log(`rolled back to the configuration recorded ${outcome.recordedAt ?? 'earlier'}:`);
        for (const name of outcome.restored) console.log(`  ${name}`);
        for (const f of outcome.failed) console.log(`  FAILED ${f.name}: ${f.error}`);
        if (outcome.restored.includes('settings.yaml')) {
          console.log('  settings.yaml lives in the dsh home and is shared by every profile.');
        }
        if (outcome.backup !== null) console.log(`  what it replaced: ${outcome.backup}`);
        console.log('  Restart dsh for this to take effect.');
      }
      console.log(renderReport({ results: after.results, healthy: after.healthy }, env));
      console.log('');
    }
  } else if (action === 'restore') {
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
      if (outcome.applied.length === 0) console.log('Nothing to fix.');
      for (const a of outcome.applied) {
        console.log(`fixed: ${a.title}`);
        for (const f of a.fixed) console.log(`  ${f}`);
        for (const f of a.failed) console.log(`  FAILED ${f.name}: ${f.error}`);
        if (a.note) for (const l of a.note.split('\n')) console.log(`  ${l}`);
      }
      if (outcome.recorded !== null && outcome.recorded !== undefined && !outcome.recorded.reused) {
        console.log(`recorded this configuration as known-good: ${outcome.recorded.files.join(', ')}`);
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
