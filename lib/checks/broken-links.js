/**
 * Check: broken profile mount paths — dangling `link:`/`file:` dependency
 * targets, dangling node_modules symlinks, and patch bundle rows whose package
 * cannot be resolved.
 *
 * This is the failure class a project/workspace move leaves behind: the
 * profile's package.json still points at the old checkout (`link:`/`file:`),
 * hand-planted node_modules symlinks still point at the old paths, and every
 * one of them breaks a different stage of the boot — bundle resolution fails
 * first, then loader insert entries fail with ERR_MODULE_NOT_FOUND. Before
 * this check existed, `status` reported "No problems found" (exit 0) on a
 * profile that could not start at all.
 *
 * Report-only by design: repairing needs to know where the project moved to,
 * which no check can guess. The findings name every broken path so the fix is
 * a mechanical edit.
 *
 * @module checks/broken-links
 */

import { existsSync, readdirSync, readFileSync, readlinkSync, lstatSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import YAML from 'yaml';

/** `link:` / `file:` spec prefix → on-disk target of a profile dependency. */
function depTarget(profileRoot, spec) {
  if (typeof spec !== 'string') return undefined;
  const m = /^(?:link|file):(.+)$/.exec(spec);
  if (m === null) return undefined;
  const raw = m[1];
  return isAbsolute(raw) ? raw : resolve(profileRoot, raw);
}

/** Names of patch rows (`- id: x` / `name: pkg`) this profile mounts. */
function patchBundleNames(profileRoot) {
  const patchPath = join(profileRoot, 'cordis.patch.yml');
  if (!existsSync(patchPath)) return [];
  let doc;
  try {
    doc = YAML.parse(readFileSync(patchPath, 'utf8'));
  } catch {
    return [];
  }
  const names = [];
  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node !== null && typeof node === 'object') {
      if (typeof node.name === 'string' && node.name.length > 0) names.push(node.name);
      for (const value of Object.values(node)) visit(value);
    }
  };
  visit(doc);
  return [...new Set(names)];
}

export const brokenLinks = {
  id: 'broken-links',
  title: 'Broken profile mount paths (dangling link:/file: targets and symlinks)',
  severity: 'critical',
  // The repair needs the new location of each moved project; guessing would
  // point the profile at the wrong tree. Report-only, so `fix` never runs.
  fixable: false,

  detect({ profileRoot }) {
    const findings = [];
    const detail = [];

    // 1. profile package.json link:/file: dependencies pointing at missing paths.
    const pkgPath = join(profileRoot, 'package.json');
    if (existsSync(pkgPath)) {
      let deps;
      try {
        deps = JSON.parse(readFileSync(pkgPath, 'utf8'))?.dependencies;
      } catch {
        deps = undefined;
      }
      if (deps !== null && typeof deps === 'object') {
        for (const [name, spec] of Object.entries(deps)) {
          const target = depTarget(profileRoot, spec);
          if (target !== undefined && !existsSync(target)) {
            findings.push({ kind: 'dep-path', name, spec, target });
            detail.push(`dependency "${name}" (${spec}) points at missing path ${target} — bundle resolution fails before anything boots`);
          }
        }
      }
    }

    // 2. node_modules entries (symlinks resolve their whole chain, so stale
    //    .dsh-module-fallback hops are caught here too).
    const nmDir = join(profileRoot, 'node_modules');
    if (existsSync(nmDir)) {
      for (const entry of readdirSync(nmDir)) {
        const entryPath = join(nmDir, entry);
        let linkTarget;
        try {
          if (!lstatSync(entryPath).isSymbolicLink()) continue;
          linkTarget = readlinkSync(entryPath);
        } catch {
          continue;
        }
        const resolved = isAbsolute(linkTarget) ? linkTarget : resolve(nmDir, linkTarget);
        if (!existsSync(resolved)) {
          findings.push({ kind: 'dangling-symlink', name: entry, target: resolved });
          detail.push(`node_modules/${entry} → ${resolved} is a dangling symlink — an insert/loader row importing it fails with ERR_MODULE_NOT_FOUND`);
        }
      }
    }

    // 3. cordis.patch.yml rows whose package is not resolvable from the profile.
    for (const name of patchBundleNames(profileRoot)) {
      const pkgJson = join(nmDir, name, 'package.json');
      if (!existsSync(pkgJson)) {
        findings.push({ kind: 'bundle-unresolvable', name });
        detail.push(`patch row "name: ${name}" cannot be resolved from the profile (no node_modules/${name}/package.json) — the loader import fails`);
      }
    }

    const ok = findings.length === 0;
    return {
      ok,
      summary: ok
        ? 'no dangling link:/file: targets, node_modules symlinks, or unresolvable patch rows'
        : `${findings.length} broken mount path(s) — the next dsh start fails until they are fixed`,
      detail,
      findings,
    };
  },
};
