/**
 * The doctor framework: run a list of checks, optionally apply their fixes.
 *
 * A check is a plain object so checks stay independently testable and the
 * registry stays a list rather than a class hierarchy:
 *
 *   {
 *     id, title, severity,          // 'critical' | 'warning'
 *     fixable: boolean,
 *     detect(env) -> { ok, summary, findings?, detail? },
 *     fix?(env, findings) -> { fixed: string[], failed: {name,error}[], note? },
 *     undo?(env) -> { restored: string[], failed: {name,error}[], note? },
 *   }
 *
 * `undo` reverses the most recent `fix` from the backup that fix left behind.
 * Every fix writes a backup, so every fix is expected to provide one.
 *
 * `detect` must never mutate anything: the report is safe to run at any time,
 * including on every settings-page open. Only `fix` writes.
 *
 * @module doctor
 */

/** Severity ranking for report ordering — worst first. */
const RANK = { critical: 0, warning: 1, info: 2 };

/**
 * Run every check's `detect`.
 *
 * A check that throws is reported as a failed check rather than aborting the
 * run: one broken probe must not hide the rest of the diagnosis.
 *
 * @param {Array} checks
 * @param {object} env - `{ profileRoot, globalRoot, dshHome }`
 * @returns {Promise<{results: Array, healthy: boolean}>}
 */
export async function diagnose(checks, env) {
  const results = [];
  for (const check of checks) {
    try {
      const outcome = await check.detect(env);
      results.push({
        id: check.id,
        title: check.title,
        severity: check.severity,
        fixable: check.fixable === true && outcome.ok !== true,
        ...outcome,
      });
    } catch (error) {
      results.push({
        id: check.id,
        title: check.title,
        severity: 'warning',
        ok: false,
        fixable: false,
        summary: `check failed to run: ${error instanceof Error ? error.message : String(error)}`,
        findings: [],
      });
    }
  }
  results.sort((a, b) => (a.ok === b.ok ? 0 : a.ok ? 1 : -1) || RANK[a.severity] - RANK[b.severity]);
  return { results, healthy: results.every((r) => r.ok) };
}

/**
 * Apply fixes for the failing, fixable checks.
 *
 * Only checks that `detect` currently reports as broken are touched, and each
 * fix receives that same detection's findings — so a fix never acts on stale
 * state.
 *
 * @param {Array} checks
 * @param {object} env
 * @param {{only?: string[]}} [opts] - restrict to specific check ids.
 * @returns {Promise<{applied: Array, healthyAfter: boolean}>}
 */
export async function repair(checks, env, opts = {}) {
  const { results } = await diagnose(checks, env);
  const applied = [];

  for (const result of results) {
    if (result.ok || !result.fixable) continue;
    if (opts.only !== undefined && !opts.only.includes(result.id)) continue;
    const check = checks.find((c) => c.id === result.id);
    if (check?.fix === undefined) continue;
    try {
      const outcome = await check.fix(env, result.findings ?? []);
      applied.push({ id: check.id, title: check.title, ...outcome });
    } catch (error) {
      applied.push({
        id: check.id,
        title: check.title,
        fixed: [],
        failed: [{ name: check.id, error: error instanceof Error ? error.message : String(error) }],
      });
    }
  }

  const after = await diagnose(checks, env);
  return { applied, healthyAfter: after.healthy, results: after.results };
}

/**
 * Reverse the most recent repair for every check that supports it.
 *
 * A fix that cannot be undone is worse than no fix: these repairs touch a user's
 * installed packages and their settings file, so the escape hatch is part of the
 * contract rather than a nicety.
 *
 * @param {Array} checks
 * @param {object} env
 * @param {{only?: string[]}} [opts]
 */
export async function rollback(checks, env, opts = {}) {
  const undone = [];
  for (const check of checks) {
    if (check.undo === undefined) continue;
    if (opts.only !== undefined && !opts.only.includes(check.id)) continue;
    try {
      const outcome = await check.undo(env);
      if (outcome.restored.length > 0 || outcome.failed.length > 0) {
        undone.push({ id: check.id, title: check.title, ...outcome });
      }
    } catch (error) {
      undone.push({
        id: check.id,
        title: check.title,
        restored: [],
        failed: [{ name: check.id, error: error instanceof Error ? error.message : String(error) }],
      });
    }
  }
  const after = await diagnose(checks, env);
  return { undone, results: after.results, healthy: after.healthy };
}

/** Render a report as plain text for the CLI and the slash command. */
export function renderReport({ results, healthy }, env) {
  const lines = [];
  if (env?.profileRoot !== undefined) lines.push(`profile: ${env.profileRoot}`);
  if (env?.globalRoot !== undefined) lines.push(`global : ${env.globalRoot}`);
  if (lines.length > 0) lines.push('');

  for (const r of results) {
    const mark = r.ok ? 'OK  ' : r.severity === 'critical' ? 'FAIL' : 'WARN';
    lines.push(`[${mark}] ${r.title}`);
    if (r.summary) lines.push(`       ${r.summary}`);
    for (const d of r.detail ?? []) lines.push(`       ${d}`);
    if (!r.ok && r.fixable) lines.push('       → fixable');
  }
  lines.push('');
  lines.push(healthy ? 'No problems found.' : 'Run `/doctor fix` (or `dsh-selfrepair fix`) to apply the fixable repairs.');
  return lines.join('\n');
}
