/**
 * `/doctor` — diagnose and repair a dsh installation.
 *
 * Two failures motivated this, both of which present as something unrelated:
 *
 *  - Duplicated profile-local packages. A plugin declaring `@deepseek-ai/*` as
 *    ordinary dependencies makes pnpm install a second copy of the dsh tree,
 *    including cordis itself. Two module instances mean two dependency-injection
 *    systems, and every agent preset then fails to mount with
 *    `prompt section "deployment:persona" is already registered`.
 *  - Unusable model configuration. A stray `baseURL: "11111"` in settings.yaml
 *    silently replaces a working built-in default, and the UI reports only that
 *    the model configuration cannot be found.
 *
 * `detect` never writes, so `/doctor` is safe to run at any time; only
 * `/doctor fix` changes anything, and every fix leaves a backup.
 *
 * @module dsh-recovery
 */

import { checks } from './checks/index.js';
import { diagnose, repair, rollback, renderReport } from './doctor.js';
import { rollbackToKnownGood } from './knowngood.js';
import { resolveEnv } from './env.js';
import { installDoctorRemote } from './remote.js';

export { resolveEnv };

/** Cordis plugin name. */
export const name = 'command-doctor';

/** The human-command registry this row contributes to. */
export const inject = ['commands'];

const USAGE = 'Usage: /doctor [status|fix|restore|rollback]';

/** Render the outcome of a repair run. */
function renderRepair({ applied, healthyAfter, results }, env) {
  const lines = [];
  if (applied.length === 0) lines.push('Nothing to fix.');
  for (const a of applied) {
    lines.push(`${a.failed.length === 0 ? 'fixed' : 'partially fixed'}: ${a.title}`);
    for (const f of a.fixed) lines.push(`  ${f}`);
    for (const f of a.failed) lines.push(`  FAILED ${f.name}: ${f.error}`);
    if (a.note) for (const l of a.note.split('\n')) lines.push(`  ${l}`);
  }
  lines.push('');
  lines.push(renderReport({ results, healthy: healthyAfter }, env));
  return lines.join('\n');
}

/** Execute one `/doctor` invocation. */
export async function execute(invocation) {
  const arg = invocation.rawInput.trim().toLowerCase();
  if (!['', 'status', 'fix', 'restore', 'rollback'].includes(arg)) return { kind: 'error', text: USAGE };

  const resolved = resolveEnv();
  if (resolved.error !== undefined) return { kind: 'error', text: resolved.error };
  const { env } = resolved;

  if (arg === 'rollback') {
    const outcome = rollbackToKnownGood(env);
    const lines = [];
    if (outcome.from === null) {
      lines.push('No known-good configuration on record — run `/doctor fix` once while the install is healthy to record one.');
    } else {
      lines.push(`rolled back to the configuration recorded ${outcome.recordedAt ?? 'earlier'}:`);
      for (const name of outcome.restored) lines.push(`  ${name}`);
      for (const f of outcome.failed) lines.push(`  FAILED ${f.name}: ${f.error}`);
      if (outcome.restored.includes('settings.yaml')) {
        lines.push('  settings.yaml lives in the dsh home and is shared by every profile.');
      }
      if (outcome.backup !== null) lines.push(`  what it replaced: ${outcome.backup}`);
      lines.push('  Restart dsh for this to take effect.');
    }
    const after = await diagnose(checks, env);
    lines.push('');
    lines.push(renderReport(after, env));
    return { kind: after.healthy ? 'success' : 'error', text: lines.join('\n') };
  }

  if (arg === 'restore') {
    const outcome = await rollback(checks, env);
    const lines = [];
    if (outcome.undone.length === 0) lines.push('Nothing to restore — no backup from a previous fix.');
    for (const u of outcome.undone) {
      lines.push(`${u.failed.length === 0 ? 'restored' : 'partially restored'}: ${u.title}`);
      for (const r of u.restored) lines.push(`  ${r}`);
      for (const f of u.failed) lines.push(`  FAILED ${f.name}: ${f.error}`);
      if (u.note) for (const l of u.note.split('\n')) lines.push(`  ${l}`);
    }
    lines.push('');
    lines.push(renderReport({ results: outcome.results, healthy: outcome.healthy }, env));
    return { kind: 'success', text: lines.join('\n') };
  }

  if (arg === 'fix') {
    const outcome = await repair(checks, env);
    return { kind: outcome.healthyAfter ? 'success' : 'error', text: renderRepair(outcome, env) };
  }

  const report = await diagnose(checks, env);
  return { kind: 'success', text: renderReport(report, env) };
}

/**
 * Register `/doctor` for every composed human-command adapter.
 * @param ctx - context carrying the command registry.
 */
/**
 * Run the diagnosis once at boot and report anything broken.
 *
 * This exists because both failures are silent until they are catastrophic: the
 * duplicated-module one only surfaces when a preset fails to mount, by which
 * point no session can start and no slash command is reachable. Reporting at
 * boot turns "dsh is broken" into a line that names the cause and the fix.
 *
 * Never throws and never writes — a diagnostic must not be able to break the
 * boot it is diagnosing.
 */
export async function bootCheck(report = console) {
  try {
    const resolved = resolveEnv();
    if (resolved.error !== undefined) return { ran: false, reason: resolved.error };
    const { results, healthy } = await diagnose(checks, resolved.env);
    if (healthy) return { ran: true, healthy: true };
    const broken = results.filter((r) => !r.ok);
    for (const r of broken) {
      report.warn?.(`dsh-recovery: ${r.title} — ${r.summary}`);
    }
    report.warn?.('dsh-recovery: run `/doctor fix` or `dsh-recovery fix` to repair.');
    return { ran: true, healthy: false, broken: broken.map((r) => r.id) };
  } catch (error) {
    return { ran: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function apply(ctx) {
  // Host Remote namespace `doctor` — the settings-page UI calls status/fix/info
  // through the connection gateway (see remote.js).
  installDoctorRemote(ctx);

  const active = new Set();
  const handler = (invocation) => {
    const operation = execute(invocation);
    active.add(operation);
    const retire = () => active.delete(operation);
    operation.then(retire, retire);
    return operation;
  };
  ctx.effect(function* () {
    yield async () => {
      await Promise.allSettled(active);
    };
    yield ctx.commands.register({
      name: 'doctor',
      description: 'Diagnose and repair the dsh installation (duplicated modules, broken model config); `rollback` puts the last known-good configuration back',
      handler,
    });
  }, 'command-doctor lifecycle');

  // Fire and forget: the boot path must not wait on a filesystem scan, and a
  // failed scan must not fail the mount.
  //
  // Deliberately `console`, not `ctx.logger`: these two failures make dsh
  // unusable, and the harness logger is level-filtered and may route away from
  // the terminal — a warning nobody sees is worse than no warning, because the
  // symptom (every preset failing to mount) points nowhere near the cause.
  void bootCheck(console);
}
