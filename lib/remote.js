/**
 * Host Remote namespace `doctor` — the channel the settings-page UI uses.
 *
 * The browser half calls `connection.rpc.call('/api', 'doctor/<method>', …)`
 * and receives the method's return value as the RPC envelope's `value`.
 * Methods return plain JSON only; a business failure is a `{ error }` return
 * value, not a thrown error, matching the panel's error-display paths.
 *
 * All methods reuse the same `diagnose` / `repair` functions as the CLI and
 * the slash command, so the settings page and the terminal report the same
 * health.
 *
 * @module remote
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { checks } from './checks/index.js';
import { diagnose, repair } from './doctor.js';
import { resolveEnv } from './env.js';

/** Largest settings.yaml excerpt handed to the model for AI detection. */
const AI_SETTINGS_CAP = 6000;

/**
 * Apply one `@Remote(method)` marker without decorator syntax: the shim
 * mimics the decorator context `addMarkerInitializer` expects, and the
 * initializer marks the prototype exactly like a real decorator would.
 */
function markRemoteMethod(prototype, method) {
  const decorator = Remote(method);
  decorator(undefined, {
    name: method,
    private: false,
    static: false,
    addInitializer(fn) { fn.call(Object.create(prototype)); },
  });
}

/** Restrict a request's `only` list to string check ids, or undefined. */
function onlyOf(request) {
  const raw = request === null || typeof request !== 'object' ? undefined : request.only;
  if (!Array.isArray(raw)) return undefined;
  const ids = raw.filter((x) => typeof x === 'string');
  return ids.length === 0 ? undefined : ids;
}

/** Read one optional service through the context, tolerating non-Cordis test doubles. */
function svc(ctx, name) {
  if (ctx === null || typeof ctx !== 'object') return undefined;
  if (typeof ctx.get !== 'function') return undefined;
  return ctx.get(name);
}

/**
 * Whether AI detection can run right now: a default model selection exists and
 * an adapter owns that provider's route. Both reads are local registry
 * lookups — no network — so this stays cheap enough to attach to every status.
 */
export function aiCapability(ctx) {
  const adm = svc(ctx, 'agentDefaultModel');
  const llm = svc(ctx, 'llm');
  let selection = null;
  try {
    if (adm !== undefined && typeof adm.currentSelection === 'function') {
      selection = adm.currentSelection() ?? null;
    }
  } catch {
    selection = null;
  }
  const provider = selection !== null && typeof selection === 'object' ? selection.provider : undefined;
  const model = selection !== null && typeof selection === 'object' ? selection.model : undefined;
  const reasoningEffort = selection !== null && typeof selection === 'object' ? selection.reasoningEffort : undefined;

  if (typeof provider !== 'string' || provider.length === 0 || typeof model !== 'string' || model.length === 0) {
    return { available: false, reason: '未配置默认模型，无法进行 AI 检测' };
  }

  let providerKnown = false;
  try {
    if (llm !== undefined && typeof llm.listProviders === 'function') {
      const providers = llm.listProviders() ?? [];
      providerKnown = Array.isArray(providers) && providers.some((p) => p !== null && typeof p === 'object' && p.provider === provider);
    }
  } catch {
    providerKnown = false;
  }
  if (!providerKnown) {
    return { available: false, provider, model, reason: `provider "${provider}" 没有可用的适配器` };
  }
  return { available: true, provider, model, reasoningEffort };
}

/** Read the raw settings.yaml text (bounded) for the AI snapshot; never credentials. */
export function settingsTextOf(dshHome) {
  const path = join(dshHome, 'settings.yaml');
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, 'utf8');
    return text.length > AI_SETTINGS_CAP ? `${text.slice(0, AI_SETTINGS_CAP)}\n…（过长已截断）` : text;
  } catch {
    return null;
  }
}

/**
 * Run the rule checks and hand the collected evidence to the default model for
 * a second opinion. Never writes. Returns a plain-JSON `{ available, ... }`
 * shape; a model failure becomes `error` (the rule results stay valid).
 */
export async function aiDiagnose(ctx, env, results) {
  const cap = aiCapability(ctx);
  if (!cap.available) return { available: false, reason: cap.reason ?? 'AI 不可用' };
  const llm = svc(ctx, 'llm');
  const snapshot = {
    dsh: { dshHome: env.dshHome, profileRoot: env.profileRoot, globalRoot: env.globalRoot },
    defaultModel: { provider: cap.provider, model: cap.model, reasoningEffort: cap.reasoningEffort ?? null },
    ruleChecks: results.map((r) => ({
      id: r.id,
      ok: r.ok,
      severity: r.severity,
      fixable: r.fixable === true,
      summary: r.summary ?? null,
      detail: r.detail ?? [],
    })),
    settingsYaml: settingsTextOf(env.dshHome),
  };

  const prompt = [
    '你是 dsh（DeepSeek Harness）的安装诊断助手。下面是一次自动规则检查收集到的诊断快照（JSON）。',
    '请只依据快照里的证据判断：1) 存在哪些真实问题（快照能证明的才列出，不要臆测）；',
    '2) 每个问题的原因与建议的修复动作；3) 若一切正常请明确说「未发现问题」。',
    '不要编造快照之外的信息，也不要建议修改快照里没有出现的内容。用中文、简洁的条目式输出。',
    '',
    JSON.stringify(snapshot, null, 2),
  ].join('\n');

  try {
    const options = {
      provider: cap.provider,
      model: cap.model,
      ...(cap.reasoningEffort ? { reasoningEffort: cap.reasoningEffort } : {}),
      system: 'You are a concise installation-diagnostics assistant for the DeepSeek Harness (dsh).',
      messages: [{
        id: 'doctor-ai-snapshot',
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'plugin', plugin: 'dsh-selfrepair' },
      }],
    };
    const stream = llm.stream(options);
    let text = '';
    for await (const chunk of stream) {
      if (chunk !== null && typeof chunk === 'object' && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        text += chunk.text;
      }
      if (chunk !== null && typeof chunk === 'object' && chunk.type === 'finish'
        && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
        const failure = chunk.reason.failure;
        throw new Error(failure && failure.message ? String(failure.message) : '模型调用失败');
      }
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return { available: true, provider: cap.provider, model: cap.model, analysis: '（模型没有返回内容）' };
    }
    return { available: true, provider: cap.provider, model: cap.model, analysis: trimmed };
  } catch (error) {
    return {
      available: true,
      provider: cap.provider,
      model: cap.model,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The `doctor` Remote namespace: every method takes one `request` JSON value. */
export class DoctorRemote extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, 'doctor');
  }

  /** Full diagnosis: environment + every check result. Never writes. */
  async status(request) {
    const resolved = resolveEnv();
    if (resolved.error !== undefined) return { error: resolved.error };
    const mode = request !== null && typeof request === 'object' && request.mode === 'ai' ? 'ai' : 'rules';
    const { results, healthy } = await diagnose(checks, resolved.env);
    const base = { env: resolved.env, healthy, results, mode, ai: aiCapability(this.ctx) };
    if (mode !== 'ai') return base;
    const ai = await aiDiagnose(this.ctx, resolved.env, results);
    return { ...base, ai };
  }

  /** Apply the fixable repairs (optionally one check), then re-diagnose. */
  async fix(request) {
    const resolved = resolveEnv();
    if (resolved.error !== undefined) return { error: resolved.error };
    const only = onlyOf(request);
    const outcome = await repair(checks, resolved.env, only === undefined ? {} : { only });
    return { env: resolved.env, ...outcome };
  }

  /** Static facts the page needs to label itself and its buttons. */
  async info(request) {
    const resolved = resolveEnv();
    return {
      env: resolved.error === undefined ? resolved.env : null,
      error: resolved.error === undefined ? null : resolved.error,
      checks: checks.map((c) => ({ id: c.id, title: c.title, severity: c.severity, fixable: c.fixable })),
      ai: aiCapability(this.ctx),
    };
  }
}

/**
 * Mark the methods once and register the service on `ctx`.
 *
 * Returns null (and marks nothing) when `ctx` is not a Cordis context capable
 * of registering a Service — the settings-page Remote is a web-profile
 * capability, and a non-Cordis test double should not have to emulate it.
 */
export function installDoctorRemote(ctx) {
  if (ctx === undefined || ctx === null || ctx.reflect === undefined) return null;
  for (const m of ['status', 'fix', 'info']) markRemoteMethod(DoctorRemote.prototype, m);
  return new DoctorRemote(ctx);
}
