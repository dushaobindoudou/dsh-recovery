/**
 * Check: `settings.yaml` parses as valid YAML with the expected top-level shape.
 *
 * dsh loads this file on every boot and merges its blocks over defaults. A
 * hand edit can corrupt the indentation or turn a block into a scalar, and the
 * symptom (model config not found, a failing boot) points nowhere near the
 * corrupt file. Unlike `llm-config` (which hunts for specific bad values),
 * this check establishes that the whole file is structurally sound.
 *
 * Not fixable: a doctor cannot know what the damaged file was meant to say.
 *
 * @module checks/settings-yaml
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

/**
 * `yaml` is an OPTIONAL dependency, loaded lazily.
 *
 * A diagnostic has to be more reliable than the installation it inspects. If
 * this module imported `yaml` at the top and the package were missing, the whole
 * check registry would fail to load — taking down `duplicate-modules` and
 * `llm-config`, which need no parser at all, and leaving the user with a doctor
 * that cannot even start. Instead the parser is resolved on first use and its
 * absence degrades only the checks that genuinely need it.
 */
let yamlModule;
function loadYaml() {
  if (yamlModule !== undefined) return yamlModule;
  try {
    // Resolved from this file, so it finds the copy shipped with dsh.
    yamlModule = createRequire(import.meta.url)('yaml');
  } catch {
    yamlModule = null;
  }
  return yamlModule;
}

/**
 * Parse YAML text without throwing.
 * @returns `{ value }`, `{ error }`, or `{ unavailable: true }` when no parser.
 */
export function parseSettingsYaml(text) {
  const YAML = loadYaml();
  if (YAML === null) return { unavailable: true };
  try {
    return { value: YAML.parse(text) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Top-level keys that must be mappings when present. */
function mustBeMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const settingsYaml = {
  id: 'settings-yaml',
  title: 'settings.yaml is valid YAML with a well-formed top level',
  severity: 'warning',
  fixable: false,

  detect({ dshHome }) {
    const path = join(dshHome, 'settings.yaml');
    if (!existsSync(path)) return { ok: true, summary: 'settings.yaml not present — defaults apply', findings: [] };

    const { value, error, unavailable } = parseSettingsYaml(readFileSync(path, 'utf8'));
    if (unavailable === true) {
      return { ok: true, summary: 'skipped: no YAML parser available in this install', findings: [] };
    }
    if (error !== undefined) {
      return { ok: false, summary: 'settings.yaml cannot be parsed as YAML', detail: [error], findings: [] };
    }
    // `null` is the empty file — "no overrides", which is a healthy default.
    // Anything else that is not a mapping is a damaged settings object.
    if (value !== null && !mustBeMapping(value)) {
      return { ok: false, summary: 'settings.yaml does not parse to a settings object', findings: [] };
    }
    if (value === null) {
      return { ok: true, summary: 'settings.yaml is empty — dsh defaults apply', findings: [] };
    }

    const issues = [];
    for (const [key, block] of Object.entries(value)) {
      if (key.startsWith('llm-') && !mustBeMapping(block)) {
        issues.push(`top-level "${key}" must be a mapping, got ${block === null ? 'null' : typeof block}`);
      }
    }
    if (value['agent-default-model'] !== undefined && !mustBeMapping(value['agent-default-model'])) {
      issues.push('top-level "agent-default-model" must be a mapping');
    }
    if (issues.length > 0) {
      return { ok: false, summary: 'settings.yaml has top-level blocks with an unexpected shape', detail: issues, findings: [] };
    }
    return { ok: true, summary: 'settings.yaml parses and its top-level blocks are well-formed', findings: [] };
  },
};
