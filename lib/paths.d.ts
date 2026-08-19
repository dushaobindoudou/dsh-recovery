/**
 * Locate the dsh installation and its profile roots from any process.
 *
 * These resolvers power the CLI, which must find `~/.dsh` and the global
 * install without any dsh runtime being available.
 *
 * @module
 */

/**
 * The global dsh install's `node_modules` directory.
 *
 * Resolution order: `$DSH_GLOBAL_ROOT`, then the real path of the running
 * `dsh` executable on `argv`, then a `node_modules/@deepseek-ai/dsh`
 * discovered from this file's own location. Returns `null` when none match.
 */
export declare function resolveGlobalRoot(
  env?: Record<string, string | undefined>,
  argv?: string[],
  execPath?: string,
): string | null;

/**
 * The profile root of the running process (`.../profiles/<name>`), found by
 * walking up from this module or `$DSH_PROFILE_ROOT`. Returns `null` when
 * the code does not live inside a profile.
 */
export declare function resolveProfileRoot(
  fromUrl?: string,
  env?: Record<string, string | undefined>,
  argv?: string[],
): string | null;

/** The profile named on `argv` (`--profile <name>` / `-p <name>`), if any. */
export declare function profileFromArgv(argv: string[], dshHome: string): string | null;

/**
 * A fresh timestamped backup directory under
 * `<profileRoot>/.dsh-doctor-backup/` (in UTC, sortable).
 */
export declare function backupDirFor(profileRoot: string, now?: Date): string;

/**
 * The newest existing backup directory for a profile, or `null` when no fix
 * ever ran. This is what `restore` reverses from.
 */
export declare function latestBackup(profileRoot: string): string | null;

/** The Harness home: `$DSH_HOME` or `~/.dsh`. */
export declare function resolveDshHome(env?: Record<string, string | undefined>): string;
