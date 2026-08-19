/**
 * The check registry. Order here is the order of repair.
 *
 * @module
 */
import type { Check } from '../types.js';

/** Every registered check, in repair order. */
export declare const checks: Check[];

export declare const duplicateModules: Check;
export declare const llmConfig: Check;
export declare const settingsYaml: Check;
export declare const agentDefaultModel: Check;
export declare const apiKey: Check;
