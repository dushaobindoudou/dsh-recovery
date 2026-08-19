/** The check registry. Order here is the order of repair. @module checks */
import { duplicateModules } from './duplicate-modules.js';
import { llmConfig } from './llm-config.js';
import { settingsYaml } from './settings-yaml.js';
import { agentDefaultModel } from './agent-default-model.js';
import { apiKey } from './api-key.js';

export const checks = [duplicateModules, llmConfig, settingsYaml, agentDefaultModel, apiKey];
export { duplicateModules, llmConfig, settingsYaml, agentDefaultModel, apiKey };
