/**
 * The last configuration this installation was known to be healthy with.
 *
 * Targeted repairs answer "what is broken and how is it undone"; a recorded
 * known-good state answers "what did this look like when it worked", which is
 * the only answer available for the report-only checks. Configuration files
 * only — the credential store is never snapshotted.
 *
 * @module
 */
import type { CheckEnv } from './types.js';

/** One file a snapshot records. */
export interface SnapshotFile {
  /** File name inside the snapshot directory. */
  name: string;
  /** Live path the file is read from and restored to. */
  path: string;
  /** Whose file it is, for reports: the dsh home's or the profile's. */
  scope: string;
}

/** What {@link recordKnownGood} wrote (or reused). */
export interface SnapshotRecord {
  /** The snapshot directory. */
  dir: string;
  /** Names of the recorded files. */
  files: string[];
  /** True when the configuration was unchanged and kept its earlier snapshot. */
  reused: boolean;
}

/** Outcome of {@link rollbackToKnownGood}. */
export interface RollbackToKnownGoodOutcome {
  /** Snapshot directory used, or null when none was on record. */
  from: string | null;
  /** ISO timestamp the snapshot was recorded at, when known. */
  recordedAt: string | null;
  restored: string[];
  failed: Array<{ name: string; error: string }>;
  /** Where the replaced files were backed up, or null when nothing was replaced. */
  backup: string | null;
}

/** Snapshot root inside a profile, beside `.dsh-doctor-backup`. */
export declare const KNOWN_GOOD_DIR: string;

/** The configuration files a snapshot covers. Never the credential store. */
export declare function snapshotFiles(env: CheckEnv): SnapshotFile[];

/**
 * Record the current configuration as known-good. Never throws: a snapshot
 * that cannot be written must not turn a working repair into a failure.
 */
export declare function recordKnownGood(
  env: CheckEnv,
  opts?: { now?: Date; keep?: number },
): SnapshotRecord | null;

/** The most recent snapshot directory, or null when none exists. */
export declare function latestKnownGood(profileRoot: string): string | null;

/** A snapshot's manifest, or null when unreadable. */
export declare function readSnapshotManifest(dir: string): {
  recordedAt: string;
  profile: string;
  dshVersion: string | null;
  files: string[];
} | null;

/** Put the most recent known-good configuration back, backing up what it replaces. */
export declare function rollbackToKnownGood(
  env: CheckEnv,
  opts?: { now?: Date },
): RollbackToKnownGoodOutcome;
