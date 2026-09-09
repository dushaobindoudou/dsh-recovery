/**
 * Check: every configured provider has an API key reachable at call time.
 *
 * A provider's `apiKeyEnv` names a credential *reference*, resolved by the
 * credentials service from the stored credential **or** the process
 * environment (`dsh-llm-pi-ai` throws MISSING_CREDENTIAL when neither holds a
 * value). This check mirrors that resolution exactly, so it flags exactly the
 * providers whose first model call would fail.
 *
 * Only key NAMES are read, never values — both from `process.env` and from
 * the credential reference names in `~/.dsh/.credentials.yaml` (the keys of
 * its `refs:` mapping in the version-1 layout `dsh-credentials-local` reads
 * and writes). A provider that declares no `apiKeyEnv` is skipped (it
 * authenticates some other way).
 *
 * @module checks/api-key
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseSettingsYaml } from './settings-yaml.js';
import { providerIndex } from './agent-default-model.js';

/**
 * Credential reference names present in the credentials store (values are
 * never read).
 *
 * The version-1 document layout `dsh-credentials-local` reads and writes has
 * every reference nested under `refs:`; the only other top-level keys are
 * `version` and `records`. Reading the top level directly (as this once did)
 * yields exactly `["version", "refs"]` and falsely reports every provider as
 * keyless.
 */
export function credentialsKeys(dshHome) {
  const path = join(dshHome, '.credentials.yaml');
  if (!existsSync(path)) return new Set();
  const { value } = parseSettingsYaml(readFileSync(path, 'utf8'));
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return new Set();
  const keys = new Set(
    value.refs !== null && typeof value.refs === 'object' && !Array.isArray(value.refs)
      ? Object.keys(value.refs)
      : [],
  );
  // Pre-release flat layout (reference names at the top level). This build of
  // dsh-credentials-local rejects it loudly, but tolerating it here is
  // harmless and keeps the check useful on an install that still carries one.
  for (const k of Object.keys(value)) {
    if (k !== 'version' && k !== 'refs' && k !== 'records') keys.add(k);
  }
  return keys;
}

export const apiKey = {
  id: 'api-key',
  title: 'Configured providers have an API key available',
  severity: 'warning',
  fixable: false,

  detect({ dshHome }) {
    const path = join(dshHome, 'settings.yaml');
    if (!existsSync(path)) return { ok: true, summary: 'settings.yaml not present', findings: [] };
    const { value, error, unavailable } = parseSettingsYaml(readFileSync(path, 'utf8'));
    if (unavailable === true) {
      return { ok: true, summary: 'skipped: no YAML parser available in this install', findings: [] };
    }
    if (error !== undefined) {
      return { ok: true, summary: 'settings.yaml unparsable — see the settings-yaml check', findings: [] };
    }

    const idx = providerIndex(value);
    const creds = credentialsKeys(dshHome);
    const missing = [];
    const detail = [];
    for (const [pid, spec] of idx) {
      if (spec.apiKeyEnv === null) continue;
      const inEnv = typeof process.env[spec.apiKeyEnv] === 'string' && process.env[spec.apiKeyEnv].length > 0;
      const inCreds = creds.has(spec.apiKeyEnv);
      if (!inEnv && !inCreds) {
        missing.push(pid);
        detail.push(`provider "${pid}" declares apiKeyEnv "${spec.apiKeyEnv}", which is in neither the process environment nor ${join(dshHome, '.credentials.yaml')}`);
      }
    }
    if (missing.length > 0) {
      return {
        ok: false,
        summary: `${missing.length} configured provider(s) have no API key anywhere`,
        detail,
        findings: missing,
      };
    }
    return {
      ok: true,
      summary: 'every configured provider has an API key in the environment or the credentials store',
      findings: [],
    };
  },
};
