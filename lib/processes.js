/**
 * Best-effort detection of RUNNING dsh processes on this machine.
 *
 * Why: a `doctor fix` rebuilds symlinks on disk, but every already-running
 * dsh process keeps the pre-fix module copies in its ESM cache — the repair
 * only takes effect after a restart. The 2026-08-27 profile incident had an
 * 11-minute broken window purely because that requirement was implicit, so
 * the fix note now names the exact PIDs that still hold stale copies.
 *
 * Detection is advisory: any failure (no `ps`, unusual output, a timeout)
 * yields an empty list and the caller falls back to the generic hint.
 *
 * @module processes
 */

import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

/**
 * Whether a command line *invokes* the dsh CLI — as the program being run, not
 * merely somewhere in its arguments.
 *
 * Typical shapes: `node /path/bin/dsh web`, `/path/bin/dsh --profile acp`,
 * `dsh web`. Only the executable is inspected, because a shell running
 * `... && dsh doctor` mentions `dsh` in its own argument string and matching
 * that would tell the user to restart their terminal. Checking the basename
 * likewise keeps `dsh-selfrepair`, `dshdoctor` and a `/some/dsh-dir/node` path
 * segment out.
 */
export function isDshCommand(command) {
  const tokens = String(command).trim().split(/\s+/).filter((t) => t !== '');
  // An interpreter-launched CLI puts the script after `node` and its flags.
  let index = 0;
  if (tokens[index] !== undefined && basename(tokens[index]) === 'node') {
    index += 1;
    while (tokens[index] !== undefined && tokens[index].startsWith('-')) index += 1;
  }
  return tokens[index] !== undefined && basename(tokens[index]) === 'dsh';
}

/**
 * Parse `ps ax -o pid=,command=` output into running dsh processes.
 *
 * @param {string} text - the `ps` output.
 * @param {number[]} [exclude] - pids to leave out. `dsh doctor` routes through
 *   the `dsh` launcher, so this run's own process and its parent match the
 *   pattern; naming them as processes "still holding stale copies" would send
 *   the user to restart the command they just ran.
 */
export function parsePsOutput(text, exclude = []) {
  const excluded = new Set(exclude);
  const out = [];
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    // Layout: "<pid> <command...>"; the command may contain anything.
    const spaceAt = trimmed.indexOf(' ');
    if (spaceAt <= 0) continue;
    const pid = Number(trimmed.slice(0, spaceAt));
    const command = trimmed.slice(spaceAt + 1);
    if (!Number.isInteger(pid) || pid <= 0 || excluded.has(pid)) continue;
    if (isDshCommand(command)) out.push({ pid, command });
  }
  return out;
}

/**
 * List running dsh processes on this machine.
 *
 * @returns {Array<{pid: number, command: string}>} possibly empty; never throws.
 */
export function runningDshProcesses() {
  try {
    const text = execFileSync('ps', ['ax', '-o', 'pid=,command='], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return parsePsOutput(text, [process.pid, process.ppid]);
  } catch {
    return [];
  }
}
