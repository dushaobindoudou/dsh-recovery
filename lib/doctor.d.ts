/**
 * The diagnosis engine: run checks, apply repairs, roll them back.
 *
 * @module
 */
import type { Check, CheckEnv, CheckResult, FixOutcome, UndoOutcome } from './types.js';

/** Restrict a repair or rollback to specific check ids. */
export interface ScopeOptions {
  only?: string[];
}

/** Full diagnosis outcome; `healthy` is `results.every(r => r.ok)`. */
export interface DiagnoseOutcome {
  results: CheckResult[];
  healthy: boolean;
}

/** One repair that ran, merged with its check's identity. */
export interface AppliedFix extends FixOutcome {
  id: string;
  title: string;
}

/** One rollback that ran, merged with its check's identity. */
export interface UndoneFix extends UndoOutcome {
  id: string;
  title: string;
}

/** Outcome of {@link repair}; re-diagnoses after applying. */
export interface RepairOutcome {
  applied: AppliedFix[];
  /** Whether the whole profile is healthy after the repairs. */
  healthyAfter: boolean;
  results: CheckResult[];
}

/** Outcome of {@link rollback}; re-diagnoses after restoring. */
export interface RollbackOutcome {
  undone: UndoneFix[];
  healthy: boolean;
  results: CheckResult[];
}

/**
 * Run every check's `detect` against one environment.
 *
 * A check that throws is reported as a failed check rather than aborting the
 * run, so one broken probe cannot hide the rest of the diagnosis.
 */
export declare function diagnose(checks: Check[], env: CheckEnv): Promise<DiagnoseOutcome>;

/**
 * Apply every fixable check's `fix` (or only the ids in `opts.only`).
 * Each fix backs up before it writes; re-diagnoses afterwards.
 */
export declare function repair(checks: Check[], env: CheckEnv, opts?: ScopeOptions): Promise<RepairOutcome>;

/**
 * Reverse the most recent fix of every check that supports `undo`
 * (or only the ids in `opts.only`).
 */
export declare function rollback(checks: Check[], env: CheckEnv, opts?: ScopeOptions): Promise<RollbackOutcome>;

/** Render a report as plain text for the CLI and the slash command. */
export declare function renderReport(
  outcome: { results: CheckResult[]; healthy: boolean },
  env?: CheckEnv,
): string;
