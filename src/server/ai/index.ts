/**
 * L'aiguillage : une configuration résolue entre, un `Ask` sort.
 *
 * C'est la seule fonction que les handlers appellent — ils ne savent pas
 * combien il y a de fournisseurs, ni lesquels partagent un protocole. Ajouter
 * un fournisseur, c'est ajouter un adaptateur et une branche ici ; `api/coach`
 * et `api/routine` n'ont rien à en apprendre.
 */

import { createAnthropicAsk } from "./anthropic.js";
import { createChatGptAsk } from "./chatgpt.js";
import { createChatAsk } from "./openai-compatible.js";
import type { Ask, ModelRequest, ProviderConfig } from "./port.js";

export function createAsk(config: ProviderConfig, request: ModelRequest): Ask {
  switch (config.provider) {
    case "anthropic":
      return createAnthropicAsk(config, request);
    case "chatgpt_subscription":
      return createChatGptAsk(config, request);
    case "openrouter":
    case "mistral":
    case "openai_compatible":
      return createChatAsk(config, request);
  }
}

export { checkBaseUrl, storedBaseUrl } from "./base-url.js";
export {
  type Ask,
  ModelError,
  type ModelMessage,
  type ModelRequest,
  modelErrorMessage,
  modelErrorStatus,
  modelTestMessage,
  type ProviderConfig,
} from "./port.js";
export {
  AiSettingsUnavailableError,
  type LoadAiSettings,
  type Resolution,
  resolveModelFor,
  type StoredAiSettings,
  toPublicSettings,
} from "./resolve.js";
