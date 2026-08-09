/**
 * L'adaptateur Anthropic : le SDK officiel, derrière le port commun.
 *
 * C'est le chemin historique du projet — celui que `api/coach` et
 * `api/routine` appelaient en ligne droite avant SPEC §5 ter. Il sert
 * désormais deux cas qui n'ont pas les mêmes contraintes :
 *
 * - la **plateforme** (`ANTHROPIC_API_KEY`, quota AimForge) : le modèle est
 *   choisi par nous, on sait exactement ce qu'il accepte, et les réglages
 *   restent ceux d'avant — réflexion désactivée et `effort: medium`, parce que
 *   le format est contraint et la tâche courte ;
 * - la **clé de l'utilisateur**, avec un identifiant de modèle qu'il a tapé.
 *   Là, on ne sait pas : `output_config.effort` est refusé (400) par plusieurs
 *   modèles `claude-*` parfaitement valides. On ne l'envoie donc pas. Un réglage
 *   d'optimisation qui fait échouer l'appel n'optimise rien.
 */

import Anthropic from "@anthropic-ai/sdk";
import { type Ask, ModelError, type ModelRequest, type ProviderConfig } from "./port.js";

/** Un bloc de contenu tel que le SDK le rend. */
interface ContentBlock {
  readonly type: string;
  readonly text?: string;
}

/**
 * Le texte d'une réponse : uniquement les blocs `text`, recollés.
 *
 * Jumeau volontaire de `textOf` (`src/server/coach/generate.ts`), qui reste la
 * référence côté coach ; les autres types de blocs (réflexion, appel d'outil)
 * n'ont pas à finir dans le JSON qu'on s'apprête à parser.
 */
function textOf(content: readonly ContentBlock[]): string {
  return content
    .flatMap((block) => (block.type === "text" && block.text !== undefined ? [block.text] : []))
    .join("\n")
    .trim();
}

function translate(config: ProviderConfig, cause: unknown): ModelError {
  if (
    cause instanceof Anthropic.AuthenticationError ||
    cause instanceof Anthropic.PermissionDeniedError
  ) {
    return new ModelError("auth", config, "clé refusée", cause.status, cause);
  }
  if (cause instanceof Anthropic.RateLimitError) {
    return new ModelError("rate_limit", config, "débit dépassé", cause.status, cause);
  }
  if (cause instanceof Anthropic.NotFoundError) {
    return new ModelError("request", config, "modèle inconnu", cause.status, cause);
  }
  if (cause instanceof Anthropic.BadRequestError) {
    // Le corps peut contenir l'écho de la requête : il part dans les logs de
    // la fonction, pas dans la réponse.
    console.error("[ai/anthropic] requête refusée", cause.message);
    return new ModelError("request", config, "requête refusée", cause.status, cause);
  }
  if (cause instanceof Anthropic.APIConnectionTimeoutError) {
    return new ModelError("timeout", config, "délai dépassé", null, cause);
  }
  if (cause instanceof Anthropic.APIError) {
    return new ModelError("unreachable", config, "service en peine", cause.status ?? null, cause);
  }
  return new ModelError("unreachable", config, "appel impossible", null, cause);
}

export function createAnthropicAsk(config: ProviderConfig, request: ModelRequest): Ask {
  const client = new Anthropic({ apiKey: config.apiKey, maxRetries: 1 });

  return async (messages, timeoutMs) => {
    try {
      const message = await client.messages.create(
        {
          model: config.model,
          max_tokens: request.maxTokens,
          system: request.system,
          // Le format est contraint et la tâche courte : la réflexion étendue
          // n'apporterait ici que de la latence et des jetons.
          thinking: { type: "disabled" },
          // Voir l'en-tête : seul le modèle de la plateforme est connu d'avance.
          ...(config.source === "platform" ? { output_config: { effort: "medium" as const } } : {}),
          messages: messages.map((entry) => ({ role: entry.role, content: entry.content })),
        },
        { timeout: timeoutMs },
      );
      const text = textOf(message.content);

      if (text === "") {
        throw new ModelError("malformed", config, "réponse sans texte");
      }
      return text;
    } catch (cause) {
      if (cause instanceof ModelError) throw cause;
      throw translate(config, cause);
    }
  };
}
