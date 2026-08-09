/**
 * L'adaptateur **expérimental** ChatGPT (abonnement) — SPEC §5 ter.
 *
 * ⚠️ Ce chemin n'est pas une API publique. Il parle au back-end que le client
 * ChatGPT d'OpenAI utilise pour lui-même, avec le **jeton de session** de
 * l'utilisateur au lieu d'une clé d'API. Rien de tout cela n'est contractuel :
 *
 * - l'URL, la forme du corps et celle des évènements peuvent changer sans
 *   préavis, et le feront ;
 * - le jeton de session expire (quelques heures à quelques jours) : il faudra
 *   le reposer, et un « ça marchait hier » est le symptôme normal ;
 * - l'accès peut être filtré par OpenAI (protection anti-robot) ; une IP de
 *   fonction serverless est un candidat de choix ;
 * - les limites de l'abonnement s'appliquent, et elles ne sont pas les mêmes
 *   que celles d'une clé d'API.
 *
 * D'où trois précautions, qui sont la raison d'être de ce fichier :
 *
 * 1. **tout est ici** : URL, en-têtes, forme du corps, lecture du flux. Le
 *    jour où OpenAI déplace quelque chose, on édite ce fichier et rien
 *    d'autre ;
 * 2. **la lecture est tolérante** : on cherche le texte là où il est
 *    raisonnablement susceptible d'être, plutôt que d'exiger une forme exacte
 *    d'un protocole non documenté ;
 * 3. **l'échec est rédigé** : il remonte comme n'importe quel `ModelError`,
 *    donc l'utilisateur lit « ta configuration personnelle a été refusée » et
 *    non une trace technique.
 *
 * L'écran de réglages affiche le badge « Expérimental » et l'avertissement :
 * l'utilisateur choisit ce chemin en connaissance de cause, ou pas du tout.
 */

import { type FetchLike, isRedirect } from "./openai-compatible.js";
import { type Ask, ModelError, type ModelRequest, type ProviderConfig } from "./port.js";

/**
 * Le point d'entrée. Constante de module et non réglage utilisateur :
 * `base_url` est réservée à `openai_compatible` par le contrat et par la base
 * (migration 0008). Si OpenAI déplace l'endpoint, c'est cette ligne qu'on
 * change — un déploiement, pas une migration.
 */
const ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";

/**
 * Le texte d'une réponse « responses », qu'elle arrive en flux d'évènements
 * ou en JSON d'un seul tenant.
 *
 * Fonction **pure** — c'est elle qu'on teste, et c'est elle qui absorbe les
 * variations de forme. Trois sources de texte sont acceptées, dans l'ordre où
 * elles sont fiables :
 *
 * 1. le champ `output_text` d'un évènement final (`response.completed`) ;
 * 2. les blocs de texte de `response.output[].content[]` ;
 * 3. à défaut, la concaténation des deltas (`response.output_text.delta`).
 */
export function readResponsesPayload(raw: string): string | null {
  const deltas: string[] = [];
  let complete: string | null = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed.startsWith("data:")) continue;

    const data = trimmed.slice("data:".length).trim();

    if (data === "" || data === "[DONE]") continue;

    let event: unknown;

    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }

    const delta = (event as { delta?: unknown } | null)?.delta;

    if (typeof delta === "string") deltas.push(delta);

    const response = (event as { response?: unknown } | null)?.response;
    const fromResponse = textOfResponse(response);

    if (fromResponse !== null) complete = fromResponse;
  }

  if (complete !== null) return complete;

  const joined = deltas.join("").trim();

  if (joined !== "") return joined;

  // Corps JSON simple (certains déploiements ne diffusent pas) : dernière
  // chance avant de déclarer la réponse illisible.
  try {
    return textOfResponse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function textOfResponse(response: unknown): string | null {
  if (response === null || typeof response !== "object") return null;

  const direct = (response as { output_text?: unknown }).output_text;

  if (typeof direct === "string" && direct.trim() !== "") return direct.trim();
  if (Array.isArray(direct)) {
    const joined = direct
      .filter((part) => typeof part === "string")
      .join("")
      .trim();

    if (joined !== "") return joined;
  }

  const output = (response as { output?: unknown }).output;

  if (!Array.isArray(output)) return null;

  const text = output
    .flatMap((item) => {
      const content = (item as { content?: unknown } | null)?.content;

      return Array.isArray(content) ? content : [];
    })
    .flatMap((part) => {
      const value = (part as { text?: unknown } | null)?.text;

      return typeof value === "string" ? [value] : [];
    })
    .join("")
    .trim();

  return text === "" ? null : text;
}

function translate(config: ProviderConfig, status: number): ModelError {
  // 401 et 403 sont le cas courant, et il a une cause banale : le jeton de
  // session a expiré. C'est la première chose que l'utilisateur doit vérifier.
  if (status === 401 || status === 403)
    return new ModelError("auth", config, "jeton refusé", status);
  if (status === 429) return new ModelError("rate_limit", config, "limite d'abonnement", status);
  if (status === 400 || status === 404 || status === 422) {
    return new ModelError("request", config, `requête refusée (${status})`, status);
  }
  return new ModelError("unreachable", config, `statut ${status}`, status);
}

export function createChatGptAsk(
  config: ProviderConfig,
  request: ModelRequest,
  fetchImpl: FetchLike = fetch,
): Ask {
  return async (messages, timeoutMs) => {
    let response: Response;

    try {
      response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          instructions: request.system,
          input: messages.map((entry) => ({
            type: "message",
            role: entry.role,
            content: [
              {
                type: entry.role === "assistant" ? "output_text" : "input_text",
                text: entry.content,
              },
            ],
          })),
          max_output_tokens: request.maxTokens,
          // Rien de ce que fait AimForge n'a vocation à rester dans l'historique
          // ChatGPT de l'utilisateur.
          store: false,
          stream: true,
        }),
        // Même règle que l'adaptateur `/chat/completions` : on ne suit pas les
        // redirections. L'endpoint est ici une constante, mais un 3xx voudrait
        // dire qu'OpenAI a déplacé la porte — ou que quelque chose s'est
        // interposé. Dans les deux cas, la suivre à l'aveugle n'aide personne.
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && /abort|timeout/i.test(cause.name);

      throw new ModelError(
        timedOut ? "timeout" : "unreachable",
        config,
        "appel impossible",
        null,
        cause,
      );
    }

    if (isRedirect(response.status)) {
      throw new ModelError("redirect", config, `redirection ${response.status}`, response.status);
    }

    if (!response.ok) {
      // Le corps peut être une page HTML de filtrage : utile en log, illisible
      // à l'écran, et jamais renvoyé au client.
      const body = await response.text().catch(() => "");

      console.error("[ai/chatgpt] appel refusé", {
        status: response.status,
        body: body.slice(0, 300),
      });
      throw translate(config, response.status);
    }

    const raw = await response.text();
    const text = readResponsesPayload(raw);

    if (text === null) {
      throw new ModelError("malformed", config, "aucun texte dans la réponse", response.status);
    }
    return text;
  };
}
