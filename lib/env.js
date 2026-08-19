/**
 * Resolve the environment every check runs against.
 *
 * Shared by the slash command (`index.js`), the CLI (`bin/doctor.js` uses its
 * own per-profile loop) and the settings-page Remote (`remote.js`), so the
 * three entry points diagnose exactly the same installation.
 *
 * @module env
 */

import { resolveGlobalRoot, resolveProfileRoot, resolveDshHome } from './paths.js';

/** Resolve `{ profileRoot, globalRoot, dshHome }`, or an error string. */
export function resolveEnv() {
  const profileRoot = resolveProfileRoot();
  const globalRoot = resolveGlobalRoot();
  const dshHome = resolveDshHome();
  if (profileRoot === null) {
    return { error: 'could not locate the profile root (no parent package.json with a `dsh.profile` field)' };
  }
  if (globalRoot === null) return { error: 'could not locate the global dsh install' };
  return { env: { profileRoot, globalRoot, dshHome } };
}
