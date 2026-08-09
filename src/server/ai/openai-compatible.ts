/**
 * L'adaptateur `/chat/completions` : OpenRouter, Mistral, et tout serveur
 * OpenAI-compatible (OpenAI, vLLM, Ollama distant, LM Studio…).
 *
 * Un seul fichier pour trois fournisseurs du contrat, parce qu'ils parlent le
 * même protocole — c'est même la raison d'être de ce protocole. Ce qui les
 * distingue tient en trois lignes : l'URL, deux en-têtes, rien d'autre. Ajouter
 * un SDK par fournisseur pour cela alourdirait le bundle serveur et la chaîne
 * d'approvisionnement sans rien apporter : `fetch` suffit, et il est déjà là.
 *
 * Le module traduit les échecs **une fois pour toutes** en `ModelError` : au-
 * dessus, personne ne relit un statut HTTP de fournisseur.
 */

import type { ProviderId } from "../../shared/ai-settings-contract.js";
import { checkBaseUrl } from "./base-url.js";
import {
  type Ask,
  ModelError,
  type ModelMessage,
  type ModelRequest,
  type ProviderConfig,
} from "./port.js";

/** Les fournisseurs que cet adaptateur sert. */
export type ChatProviderId = Extract<ProviderId, "openrouter" | "mistral" | "openai_compatible">;

/** Points d'entrée connus. `openai_compatible` apporte le sien. */
const KNOWN_ENDPOINTS: Readonly<Record<"openrouter" | "mistral", string>> = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
};

export interface ChatEndpoint {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * L'URL et les en-têtes de l'appel.
 *
 * OpenRouter demande une identification de l'application (`HTTP-Referer`,
 * `X-Title`) pour attribuer l'usage ; elle est facultative mais gratuite, et
 * son absence fait apparaître les appels comme anonymes dans le tableau de
 * bord de l'utilisateur — qui paie, et a le droit de savoir ce qui consomme.
 */
export function chatEndpoint(config: ProviderConfig): ChatEndpoint {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Bearer ${config.apiKey}`,
  };

  if (config.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://aimforge.app";
    headers["X-Title"] = "AimForge";
    return { url: KNOWN_ENDPOINTS.openrouter, headers };
  }
  if (config.provider === "mistral") {
    return { url: KNOWN_ENDPOINTS.mistral, headers };
  }

  const checked = checkBaseUrl(config.baseUrl ?? "");

  if (!checked.ok) {
    throw new ModelError("request", config, `URL de base inutilisable: ${checked.reason}`);
  }
  return { url: checked.url, headers };
}

/* ------------------------------------------------------------------ */
/* Lecture de la réponse                                               */
/* ------------------------------------------------------------------ */

interface ChatChoice {
  readonly message?: { readonly content?: unknown } | null;
}

/**
 * Le texte d'une complétion, ou `null` si la réponse n'en contient pas.
 *
 * `content` est une chaîne dans la spécification d'origine, mais plusieurs
 * serveurs rendent désormais une liste de blocs (`[{type:"text",text:"…"}]`).
 * Les deux sont acceptés : refuser la seconde ferait échouer l'adaptateur sur
 * une réponse parfaitement valide, pour une question de forme d'emballage.
 *
 * Fonction pure : c'est ici que se teste la tolérance aux variantes.
 */
export function readChatCompletion(body: unknown): string | null {
  const choices = (body as { choices?: unknown } | null)?.choices;

  if (!Array.isArray(choices) || choices.length === 0) return null;

  const content = (choices[0] as ChatChoice | null)?.message?.content;

  if (typeof content === "string") {
    const trimmed = content.trim();

    return trimmed === "" ? null : trimmed;
  }
  if (!Array.isArray(content)) return null;

  const text = content
    .flatMap((part) => {
      const value = (part as { text?: unknown } | null)?.text;

      return typeof value === "string" ? [value] : [];
    })
    .join("")
    .trim();

  return text === "" ? null : text;
}

/* ------------------------------------------------------------------ */
/* Appel                                                               */
/* ------------------------------------------------------------------ */

/** Le `fetch` utilisé, injectable pour les tests. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface ChatBody {
  readonly model: string;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly max_tokens?: number;
  readonly max_completion_tokens?: number;
  readonly stream: false;
}

function buildBody(
  config: ProviderConfig,
  request: ModelRequest,
  messages: readonly ModelMessage[],
  tokenField: "max_tokens" | "max_completion_tokens",
): ChatBody {
  return {
    model: config.model,
    messages: [
      { role: "system", content: request.system },
      ...messages.map((entry) => ({ role: entry.role, content: entry.content })),
    ],
    // Un seul des deux champs est envoyé : plusieurs serveurs refusent celui
    // qu'ils ne connaissent pas plutôt que de l'ignorer.
    ...(tokenField === "max_tokens"
      ? { max_tokens: request.maxTokens }
      : { max_completion_tokens: request.maxTokens }),
    stream: false,
  };
}

/**
 * Les modèles récents d'OpenAI refusent `max_tokens` et exigent
 * `max_completion_tokens`. Le refus est net (400) et le message le dit ; c'est
 * la seule reprise automatique de ce module, et elle est bornée à une.
 *
 * L'alternative — deviner d'après le nom du modèle — se tromperait à chaque
 * sortie de modèle et sur chaque serveur tiers qui n'a pas suivi le
 * changement. Ici, c'est le fournisseur qui nous dit quoi faire.
 */
function wantsCompletionTokens(status: number, body: string): boolean {
  return status === 400 && body.includes("max_completion_tokens");
}

/** Une réponse de redirection, quelle que soit sa forme (301, 302, 307, 308…). */
export function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function translate(config: ProviderConfig, status: number, body: string): ModelError {
  const detail = `statut ${status}`;

  if (status === 401 || status === 403) return new ModelError("auth", config, detail, status);
  if (status === 402 || status === 429) {
    return new ModelError("rate_limit", config, detail, status);
  }
  if (status >= 500) return new ModelError("unreachable", config, detail, status);
  // 400, 404, 422… : la requête est refusée telle qu'elle est écrite. Le corps
  // part dans les logs de la fonction, jamais dans la réponse — il contient
  // parfois l'écho de la requête, donc potentiellement la clé.
  console.error(`[ai/${config.provider}] requête refusée`, { status, body: body.slice(0, 500) });
  return new ModelError("request", config, detail, status);
}

/**
 * Le port `Ask`, câblé sur `/chat/completions`.
 *
 * Aucune sortie structurée n'est demandée (`response_format`) : tous les
 * serveurs ne la connaissent pas, plusieurs la refusent avec un 400 et
 * certains l'acceptent en changeant le style de la réponse. Le contrat JSON
 * est déjà tenu par le prompt et par la relance corrective de
 * `generateDebrief`/`generateRoutine` — c'est-à-dire par du code qu'on teste,
 * pas par une option qu'on espère.
 */
export function createChatAsk(
  config: ProviderConfig,
  request: ModelRequest,
  fetchImpl: FetchLike = fetch,
): Ask {
  const endpoint = chatEndpoint(config);

  return async (messages, timeoutMs) => {
    let tokenField: "max_tokens" | "max_completion_tokens" = "max_tokens";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;

      try {
        response = await fetchImpl(endpoint.url, {
          method: "POST",
          headers: endpoint.headers,
          body: JSON.stringify(buildBody(config, request, messages, tokenField)),
          // Voir le traitement des 3xx plus bas : l'URL a été vérifiée, la
          // suite d'une chaîne de redirections ne le serait pas.
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

      // Une redirection n'est pas suivie, et n'est pas non plus traitée comme
      // une erreur ordinaire : `checkBaseUrl` a validé **cette** adresse, pas
      // celle que le serveur distant désignerait ensuite. Sans ce refus, un
      // hôte public autorisé pourrait renvoyer 302 vers 169.254.169.254 et
      // faire porter l'appel à notre fonction — la vérification d'URL ne
      // vaudrait plus que pour le premier maillon de la chaîne.
      if (isRedirect(response.status)) {
        throw new ModelError("redirect", config, `redirection ${response.status}`, response.status);
      }

      if (!response.ok) {
        const body = await response.text().catch(() => "");

        if (attempt === 0 && wantsCompletionTokens(response.status, body)) {
          tokenField = "max_completion_tokens";
          continue;
        }
        throw translate(config, response.status, body);
      }

      let payload: unknown;

      try {
        payload = await response.json();
      } catch (cause) {
        throw new ModelError("malformed", config, "réponse illisible", response.status, cause);
      }

      const text = readChatCompletion(payload);

      if (text === null) {
        throw new ModelError("malformed", config, "aucun texte dans la réponse", response.status);
      }
      return text;
    }

    // Inatteignable : la boucle rend ou lève à chaque tour. Présent pour que
    // le compilateur n'ait pas à le déduire.
    throw new ModelError("unreachable", config, "aucune tentative aboutie");
  };
}
