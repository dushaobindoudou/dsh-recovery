/**
 * The `doctor` Remote namespace - the settings page's JSON-RPC surface.
 *
 * Every method takes one `request` JSON value and returns plain JSON; the
 * direction is client -> host, so nothing live crosses the boundary.
 *
 * @module
 */
import type { AppliedFix, CheckResult, DiagnoseOutcome, RepairOutcome, RollbackOutcome } from './doctor.js';
import type { CheckEnv } from './types.js';

/** A minimal structural view of the Cordis context the service needs. */
export interface RemoteContext {
  /** Read an optional service; `undefined` when absent. */
  get(name: string): unknown;
  /** Cordis service registration surface. */
  reflect: unknown;
}

/**
 * Whether AI detection can run right now: a default model selection exists
 * and an adapter owns that provider's route. Both reads are local registry
 * lookups - no network.
 */
export interface AiCapability {
  available: boolean;
  provider?: string;
  model?: string;
  /** Why not, when `available` is false. */
  reason?: string;
}

/** The model's second opinion over the rule findings. */
export interface AiAnalysis extends AiCapability {
  /** The analysis text, when the call succeeded. */
  analysis?: string;
  /** The failure message, when the call itself failed. */
  error?: string;
}

/** `doctor/status` request. */
export interface StatusRequest {
  /** `'ai'` asks the default model to interpret the rule findings. */
  mode?: 'ai' | 'rules';
}

/** `doctor/status` response. */
export interface StatusResponse {
  env: CheckEnv;
  healthy: boolean;
  results: CheckResult[];
  /** The mode this response was produced with. */
  mode: 'ai' | 'rules';
  /** Present when the host build supports AI detection. */
  ai?: AiCapability & Partial<Pick<AiAnalysis, 'analysis' | 'error'>>;
}

/** `doctor/fix` request. */
export interface FixRequest {
  /** Restrict to specific check ids; omit to fix everything fixable. */
  only?: string[];
}

/** `doctor/fix` response. */
export interface FixResponse extends RepairOutcome {
  env: CheckEnv;
}

/** `doctor/info` response - static facts for the page's labels. */
export interface InfoResponse {
  env: CheckEnv | null;
  error: string | null;
  checks: Array<{ id: string; title: string; severity: string; fixable: boolean }>;
  /** Present when the host build supports AI detection. */
  ai?: AiCapability;
}

/**
 * The `doctor` Remote service (`dsh-selfrepair/lib/remote`).
 *
 * Typed structurally; the runtime class extends the Typert remote base the
 * host provides, so consumers never need that peer to compile against this.
 */
export declare class DoctorRemote {
  constructor(ctx: RemoteContext);
  /** Full diagnosis: environment + every check result. Never writes. */
  status(request: StatusRequest): Promise<StatusResponse | { error: string }>;
  /** Apply the fixable repairs (optionally one check), then re-diagnose. */
  fix(request: FixRequest): Promise<FixResponse | { error: string }>;
  /** Static facts the page needs to label itself and its buttons. */
  info(request: Record<string, never>): Promise<InfoResponse>;
}

/**
 * Register the service on `ctx` (id `doctor`). Returns the service, or
 * `null` when `ctx` cannot register services - the settings-page Remote is a
 * web-profile capability, and non-Cordis test doubles skip it.
 */
export declare function installDoctorRemote(ctx: RemoteContext): DoctorRemote | null;

/** Probe the AI capability of a context (see {@link AiCapability}). */
export declare function aiCapability(ctx: RemoteContext): AiCapability;

/**
 * Run the model's second opinion over collected evidence: rule results plus
 * a bounded snapshot of `settings.yaml` (names only, never credential
 * values). Never throws - failures come back as `{ error }`.
 */
export declare function aiDiagnose(
  ctx: RemoteContext,
  env: CheckEnv,
  results: CheckResult[],
): Promise<AiAnalysis>;

/** The first `AI_SETTINGS_CAP` bytes of `settings.yaml`, for AI evidence. */
export declare function settingsTextOf(dshHome: string): string | null;
