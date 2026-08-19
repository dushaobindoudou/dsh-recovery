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
 * the keys of `~/.dsh/.credentials.yaml`. A provider that declares no
 * `apiKeyEnv` is skipped (it authenticates some other way).
 *
 * @module checks/api-key
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseSettingsYaml } from './settings-yaml.js';
import { providerIndex } from './agent-default-model.js';

/** Key names present in the credentials store (values are never read). */
export function credentialsKeys(dshHome) {
  const path = join(dshHome, '.credentials.yaml');
  if (!existsSync(path)) return new Set();
  const { value } = parseSettingsYaml(readFileSync(path, 'utf8'));
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return new Set();
  return new Set(Object.keys(value));
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
