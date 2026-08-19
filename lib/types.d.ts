/**
 * Shared contracts for the dsh-selfrepair engine.
 *
 * The check contract is the whole extension surface: a check that honors it
 * works in the CLI, the `/doctor` command, and the settings page alike.
 *
 * @module
 */

/**
 * The three roots every check operates on.
 */
export interface CheckEnv {
  /**
   * The profile root whose `node_modules` is scanned, e.g.
   * `~/.dsh/profiles/web`.
   */
  profileRoot: string;
  /** The running dsh installation's `node_modules` directory. */
  globalRoot: string;
  /** The Harness home (`$DSH_HOME`); holds `settings.yaml` and profiles. */
  dshHome: string;
}

/** Severity shown in reports and on the settings page. */
export type Severity = 'critical' | 'warning';

/**
 * One problem a check detected. Shapes vary per check; `fix` receives the
 * array back so it never has to re-derive what to repair.
 */
export interface CheckFinding {
  [key: string]: unknown;
}

/**
 * Result of one check's `detect`.
 *
 * `detect` must never write - the report is safe to run at any time.
 */
export interface CheckResult {
  ok: boolean;
  /** One-line human-readable outcome, shown in reports and cards. */
  summary: string;
  /** The concrete problems; passed back to `fix`. */
  findings?: CheckFinding[];
  /** Extra lines for the report body (paths, hints). */
  detail?: string[];
}

/** A failed sub-step of a `fix` or `undo`. */
export interface FixFailure {
  name: string;
  error: string;
}

/** Result of one check's `fix`. */
export interface FixOutcome {
  /** Human-readable names of what was repaired. */
  fixed: string[];
  failed: FixFailure[];
  /** Shown in reports; conventions like `backup: <path>` link to restore. */
  note?: string;
}

/**
 * Result of one check's `undo` - restores the state the most recent `fix`
 * backed up.
 */
export interface UndoOutcome {
  /** Human-readable names of what was restored. */
  restored: string[];
  failed: FixFailure[];
  note?: string;
}

/**
 * The check contract.
 *
 * `detect` is required and must be side-effect free. `fix` and `undo` are
 * optional; a check without `fix` is report-only, without `undo` its fixes
 * are permanent (make that a deliberate choice - see README).
 */
export interface Check {
  /** Kebab-case identifier, used by `--only <id>` and machine output. */
  id: string;
  /** Human-readable title for reports and settings cards. */
  title: string;
  severity: Severity;
  /** Whether the settings page offers a repair button for this check. */
  fixable: boolean;
  detect(env: CheckEnv): CheckResult | Promise<CheckResult>;
  fix?(env: CheckEnv, findings: CheckFinding[]): FixOutcome | Promise<FixOutcome>;
  /** Enables `restore`; reverses the most recent `fix` from its backup. */
  undo?(env: CheckEnv): UndoOutcome | Promise<UndoOutcome>;
}
