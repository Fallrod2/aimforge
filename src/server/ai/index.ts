/**
 * L'aiguillage : une configuration résolue entre, un `Ask` sort.
 *
 * C'est la seule fonction que les handlers appellent — ils ne savent pas
 * combien il y a de fournisseurs, ni lesquels partagent un protocole. Ajouter
 * un fournisseur, c'est ajouter un adaptateur et une branche ici ; `api/coach`
 * et `api/routine` n'ont rien à en apprendre.
 */

import { createAnthropicAsk } from "./anthropic.js";
import { type ChatGptDeps, createChatGptAsk } from "./chatgpt.js";
import { createChatAsk } from "./openai-compatible.js";
import type { Ask, ModelRequest, ProviderConfig } from "./port.js";

/**
 * Ce dont un adaptateur peut avoir besoin en plus de sa configuration.
 *
 * Un seul en fait usage aujourd'hui — ChatGPT (abonnement), dont les jetons se
 * rafraîchissent et doivent être réécrits (SPEC §5 ter). Les autres l'ignorent,
 * et c'est pour cela que le paramètre est facultatif : brancher un fournisseur
 * à clé ne demande toujours rien de plus qu'une clé.
 */
export type AskDeps = ChatGptDeps;

export function createAsk(config: ProviderConfig, request: ModelRequest, deps: AskDeps = {}): Ask {
  switch (config.provider) {
    case "anthropic":
      return createAnthropicAsk(config, request);
    case "chatgpt_subscription":
      return createChatGptAsk(config, request, deps);
    case "openrouter":
    case "mistral":
    case "openai_compatible":
      return createChatAsk(config, request);
  }
}

export { checkBaseUrl, storedBaseUrl } from "./base-url.js";
export { linkSecret } from "./codex-handle.js";
export {
  DEVICE_AUTH_DISABLED,
  type LinkDeps,
  type PollOutcome,
  pollLink,
  START_UNAVAILABLE,
  type StartOutcome,
  startLink,
} from "./codex-link.js";
export {
  type Ask,
  type ModelAnswer,
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
  type PlatformAiConfig,
  type Resolution,
  resolveModelFor,
  type StoredAiSettings,
  toPublicSettings,
} from "./resolve.js";
