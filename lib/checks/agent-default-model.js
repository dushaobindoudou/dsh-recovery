/**
 * Check: the configured default model can be resolved.
 *
 * `agent-default-model: { provider, model }` selects which model every new
 * session starts with. If it names a provider the user configured but a model
 * that provider's `models:` list does not contain, the selection cannot work
 * and every session fails before the first prompt.
 *
 * Providers that are NOT among the user's `providers:` trees are left alone:
 * they may be built-in catalog entries whose full model list lives inside dsh
 * and is not visible from `settings.yaml`. Only provable mismatches are
 * reported, so the check never guesses.
 *
 * @module checks/agent-default-model
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseSettingsYaml } from './settings-yaml.js';

/** A model entry may be a bare string or `{ id, name }`. */
function modelIds(raw) {
  const out = new Set();
  if (!Array.isArray(raw)) return out;
  for (const m of raw) {
    if (typeof m === 'string' && m.length > 0) out.add(m);
    else if (m !== null && typeof m === 'object' && typeof m.id === 'string' && m.id.length > 0) out.add(m.id);
  }
  return out;
}

/**
 * Index every user-configured provider from the parsed settings value.
 *
 * @param {object|null} value - parsed settings.yaml (or null).
 * @returns {Map<string, {apiKeyEnv: string|null, models: Set<string>}>}
 *   provider id → its configured model ids and optional `apiKeyEnv`.
 */
export function providerIndex(value) {
  const providers = new Map();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return providers;
  for (const [key, block] of Object.entries(value)) {
    if (!key.startsWith('llm-')) continue;
    if (block === null || typeof block !== 'object' || Array.isArray(block)) continue;
    const list = block.providers;
    if (list === null || typeof list !== 'object' || Array.isArray(list)) continue;
    for (const [pid, spec] of Object.entries(list)) {
      if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) continue;
      providers.set(pid, {
        apiKeyEnv: typeof spec.apiKeyEnv === 'string' ? spec.apiKeyEnv : null,
        models: modelIds(spec.models),
      });
    }
  }
  return providers;
}

export const agentDefaultModel = {
  id: 'agent-default-model',
  title: 'agent-default-model selects a usable provider and model',
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

    const adm = value?.['agent-default-model'];
    if (adm === undefined || adm === null) {
      return { ok: true, summary: 'default model not overridden — dsh defaults apply', findings: [] };
    }
    if (typeof adm !== 'object' || Array.isArray(adm)) {
      return { ok: false, summary: '"agent-default-model" must be a mapping, got ' + (adm === null ? 'null' : typeof adm), findings: [] };
    }

    const provider = typeof adm.provider === 'string' ? adm.provider : null;
    if (provider === null || provider.length === 0) {
      return { ok: false, summary: '"agent-default-model" is missing a provider', findings: [] };
    }

    const idx = providerIndex(value);
    const spec = idx.get(provider);
    if (spec === undefined) {
      return {
        ok: true,
        summary: `provider "${provider}" is not among your configured providers (may be a built-in catalog entry)`,
        findings: [],
      };
    }

    const model = typeof adm.model === 'string' ? adm.model : null;
    if (model === null || model.length === 0) {
      return { ok: false, summary: `provider "${provider}" is configured, but no model is selected`, findings: [] };
    }
    if (spec.models.has(model)) {
      return { ok: true, summary: `default model ${provider}/${model} is in that provider's configured list`, findings: [] };
    }
    return {
      ok: false,
      summary: `default model "${model}" is not in provider "${provider}"'s configured model list`,
      findings: [],
    };
  },
};
