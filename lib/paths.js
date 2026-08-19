/**
 * Locate the two roots this tool reconciles: the global dsh install and the
 * profile the current process booted.
 *
 * Both are discovered from the running process rather than configured, so the
 * command works in any profile without setup. Every strategy is best-effort and
 * returns null instead of throwing, letting the caller report a clear reason.
 *
 * @module paths
 */

import { realpathSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Read a manifest, or null when absent/unparsable. */
function manifest(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Walk up from `start`, returning the first dir whose manifest matches. */
function walkUp(start, predicate, limit = 8) {
  let dir = start;
  for (let i = 0; i < limit; i += 1) {
    const pkg = manifest(dir);
    if (pkg !== null && predicate(pkg)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * The `@deepseek-ai/dsh` package directory.
 *
 * `process.argv[1]` is the booted `dsh` bin; its real path sits inside the
 * global install, so walking up finds the package root. `DSH_GLOBAL_ROOT`
 * overrides it for tests and unusual layouts.
 */
export function resolveGlobalRoot(env = process.env, argv = process.argv, execPath = process.execPath) {
  if (env.DSH_GLOBAL_ROOT) return resolve(env.DSH_GLOBAL_ROOT);

  // Inside a booted dsh, argv[1] is the dsh bin; its real path sits in the install.
  const entry = argv[1];
  if (typeof entry === 'string' && entry.length > 0) {
    try {
      const found = walkUp(dirname(realpathSync(entry)), (pkg) => pkg.name === '@deepseek-ai/dsh');
      if (found !== null) return found;
    } catch {
      // fall through to the interpreter-relative guess
    }
  }

  // Standalone CLI: argv[1] is this script, not dsh. Node's global package root
  // is `<prefix>/lib/node_modules`, and the interpreter lives at `<prefix>/bin/node`,
  // which holds for nvm and for standard installs alike.
  try {
    const candidate = join(dirname(dirname(realpathSync(execPath))), 'lib', 'node_modules', '@deepseek-ai', 'dsh');
    const pkg = manifest(candidate);
    if (pkg !== null && pkg.name === '@deepseek-ai/dsh') return candidate;
  } catch {
    return null;
  }
  return null;
}

/**
 * The profile directory of the running process.
 *
 * This module is loaded from inside the profile's `node_modules`, so walking up
 * from its own location reaches the profile root — the directory whose manifest
 * carries a `dsh.profile` field.
 */
export function resolveProfileRoot(fromUrl = import.meta.url, env = process.env, argv = process.argv) {
  if (env.DSH_PROFILE_ROOT) return resolve(env.DSH_PROFILE_ROOT);

  // Normal install: this module sits inside the profile's node_modules, so the
  // profile root is an ancestor.
  try {
    const found = walkUp(dirname(fileURLToPath(fromUrl)), (pkg) => pkg?.dsh?.profile !== undefined, 10);
    if (found !== null) return found;
  } catch {
    // fall through to argv
  }

  // Development install: the package is symlinked in from elsewhere, so
  // `import.meta.url` resolves outside the profile entirely. The booted profile
  // is still knowable from the command line — `dsh --profile <name>` or the
  // `dsh <alias>` subcommand form.
  return profileFromArgv(argv, resolveDshHome(env));
}

/** Derive the booted profile directory from the dsh command line. */
export function profileFromArgv(argv, dshHome) {
  const asProfile = (candidate) => {
    if (typeof candidate !== 'string' || candidate.length === 0) return null;
    const dir = join(dshHome, 'profiles', candidate);
    return existsSync(join(dir, 'package.json')) ? dir : null;
  };

  const flag = argv.indexOf('--profile');
  if (flag >= 0) return asProfile(argv[flag + 1]);

  // Only the FIRST positional is a profile alias (`dsh web --port 0`); anything
  // after it belongs to that profile's own app.
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('-')) continue;
    return asProfile(arg);
  }
  return null;
}

/** Timestamped backup dir for one repair run, inside the profile. */
export function backupDirFor(profileRoot, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return join(profileRoot, '.dsh-doctor-backup', stamp);
}

/** Most recent backup dir, or null when none exists. */
export function latestBackup(profileRoot) {
  const root = join(profileRoot, '.dsh-doctor-backup');
  if (!existsSync(root)) return null;
  let entries;
  try {
    entries = readdirSync(root).sort();
  } catch {
    return null;
  }
  const last = entries[entries.length - 1];
  return last === undefined ? null : join(root, last);
}

/** The dsh home directory holding `settings.yaml` and `profiles/`. */
export function resolveDshHome(env = process.env) {
  if (env.DSH_HOME) return resolve(env.DSH_HOME);
  return join(env.HOME ?? process.cwd(), '.dsh');
}
