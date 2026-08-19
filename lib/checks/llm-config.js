/**
 * Check: model configuration in `settings.yaml` that cannot work.
 *
 * dsh merges a user block over the built-in provider defaults, so a stray value
 * silently replaces a working one. The case this was written for:
 *
 *   llm-deepseek:
 *     baseURL: "11111"     # overrides https://api.deepseek.com
 *     models: []           # empties the built-in model list
 *
 * The symptom is "model configuration not found" with no indication that a
 * local override caused it.
 *
 * The fix removes only the unusable keys, never a whole provider block a user
 * may have written on purpose. A block reduced to nothing is dropped entirely,
 * which is what restores the built-in default.
 *
 * @module checks/llm-config
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

/** Top-level keys that configure an LLM provider namespace. */
const LLM_KEY = /^(llm-[a-z0-9-]+):\s*$/;

/** A baseURL that cannot be a real endpoint. */
function badBaseURL(value) {
  const v = value.trim().replace(/^["']|["']$/g, '');
  if (v.length === 0) return 'empty';
  if (!/^https?:\/\//i.test(v)) return `not an http(s) URL: ${JSON.stringify(v)}`;
  return null;
}

/**
 * Parse the flat top-level structure we care about without a YAML dependency.
 *
 * Only top-level `llm-*:` blocks and their immediate two-space children are
 * inspected, which is exactly where these corruptions live. Anything deeper is
 * left untouched, so a hand-written provider list is never rewritten.
 */
export function findConfigProblems(text) {
  const lines = text.split('\n');
  const problems = [];
  let block = null;

  const flushable = (i) => lines[i] !== undefined && /^\s{2}\S/.test(lines[i]);

  for (let i = 0; i < lines.length; i += 1) {
    const m = LLM_KEY.exec(lines[i]);
    if (m === null) continue;
    block = { key: m[1], start: i, children: [] };
    for (let j = i + 1; j < lines.length && (flushable(j) || lines[j].trim() === ''); j += 1) {
      if (lines[j].trim() === '') continue;
      block.children.push({ line: j, text: lines[j] });
    }
    // Only flag a block when it has no nested structure of its own (a real
    // provider list lives under `providers:` and is deeper than this).
    const hasProviders = block.children.some((c) => /^\s{2}providers:/.test(c.text));
    if (hasProviders) continue;

    for (const child of block.children) {
      const base = /^\s{2}baseURL:\s*(.+?)\s*$/.exec(child.text);
      if (base !== null) {
        const why = badBaseURL(base[1]);
        if (why !== null) problems.push({ block: block.key, line: child.line, kind: 'baseURL', why, text: child.text.trim() });
      }
      const models = /^\s{2}models:\s*\[\s*\]\s*$/.exec(child.text);
      if (models !== null) {
        problems.push({ block: block.key, line: child.line, kind: 'models', why: 'empty list overrides the built-in models', text: child.text.trim() });
      }
    }
  }
  return problems;
}

/** Remove the flagged lines, dropping a block that becomes childless. */
export function stripProblems(text, problems) {
  const lines = text.split('\n');
  const drop = new Set(problems.map((p) => p.line));

  // A block whose every child is dropped must go too, so the built-in default
  // applies again instead of an empty override.
  for (const key of new Set(problems.map((p) => p.block))) {
    const start = lines.findIndex((l) => LLM_KEY.exec(l)?.[1] === key);
    if (start < 0) continue;
    const children = [];
    for (let j = start + 1; j < lines.length; j += 1) {
      if (lines[j].trim() === '') continue;
      if (!/^\s{2}\S/.test(lines[j])) break;
      children.push(j);
    }
    if (children.every((c) => drop.has(c))) drop.add(start);
  }
  return lines.filter((_, i) => !drop.has(i)).join('\n');
}

export const llmConfig = {
  id: 'llm-config',
  title: 'Unusable model configuration in settings.yaml',
  severity: 'critical',
  fixable: true,

  detect({ dshHome }) {
    const path = join(dshHome, 'settings.yaml');
    if (!existsSync(path)) return { ok: true, summary: 'settings.yaml not present', findings: [] };
    const problems = findConfigProblems(readFileSync(path, 'utf8'));
    return {
      ok: problems.length === 0,
      summary: problems.length === 0
        ? 'no unusable provider overrides'
        : `${problems.length} setting(s) override a working default with an unusable value`,
      detail: problems.map((p) => `${p.block}.${p.kind}: ${p.why}`),
      findings: problems,
    };
  },

  fix({ dshHome }, findings) {
    const path = join(dshHome, 'settings.yaml');
    const backup = `${path}.doctor-backup`;
    copyFileSync(path, backup);
    const text = readFileSync(path, 'utf8');
    writeFileSync(path, stripProblems(text, findings));
    return {
      fixed: findings.map((f) => `${f.block}.${f.kind}`),
      failed: [],
      note: `backup: ${backup}`,
    };
  },

  undo({ dshHome }) {
    const path = join(dshHome, 'settings.yaml');
    const backup = `${path}.doctor-backup`;
    if (!existsSync(backup)) return { restored: [], failed: [] };
    copyFileSync(backup, path);
    return { restored: ['settings.yaml'], note: `from ${backup}`, failed: [] };
  },
};
