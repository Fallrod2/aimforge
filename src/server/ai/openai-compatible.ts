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
/* Modèles raisonneurs                                                 */
/* ------------------------------------------------------------------ */

/**
 * La réponse est-elle vide **parce que le modèle a raisonné** au lieu de
 * répondre ?
 *
 * Le cas réel : `deepseek/deepseek-v4-flash-0731` répond 200, `content` vide,
 * `finish_reason: "length"`, et tout le budget passé dans `reasoning`. Un
 * modèle raisonneur dépense d'abord ses jetons en réflexion interne ; avec les
 * 2 000 à 3 000 jetons que le coach et la routine accordent, il n'en reste
 * aucun pour écrire le JSON demandé.
 *
 * Sans cette lecture, l'échec ressortait en `malformed` — « ce modèle ne
 * convient peut-être pas », qui est vrai mais n'explique rien, et surtout
 * n'indique pas les deux seuls gestes qui marchent : changer de modèle, ou
 * agrandir le budget.
 *
 * Deux indices, et il en faut **un** en plus du contenu vide :
 *
 * - des jetons de raisonnement dans la réponse (`reasoning`,
 *   `reasoning_details`, `reasoning_content` selon les fournisseurs) : preuve
 *   directe ;
 * - `finish_reason: "length"` : la réponse a été tronquée par le plafond. Sur
 *   un contenu vide, cela ne peut vouloir dire qu'une chose — le plafond a été
 *   atteint **avant** le premier mot de la réponse.
 *
 * Fonction pure : elle se teste sur un corps réel, sans réseau.
 */
export function spentOnReasoning(body: unknown): boolean {
  const choices = (body as { choices?: unknown } | null)?.choices;

  if (!Array.isArray(choices) || choices.length === 0) return false;

  const choice = choices[0] as {
    readonly message?: Record<string, unknown> | null;
    readonly finish_reason?: unknown;
  } | null;

  // Un contenu exploitable exclut ce diagnostic : le modèle a bien répondu.
  if (readChatCompletion(body) !== null) return false;

  const message = choice?.message ?? null;
  const reasoned =
    message !== null &&
    ["reasoning", "reasoning_content", "reasoning_details"].some((field) => {
      const value = message[field];

      if (typeof value === "string") return value.trim() !== "";
      return Array.isArray(value) ? value.length > 0 : false;
    });

  return reasoned || choice?.finish_reason === "length";
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
  readonly reasoning?: { readonly effort: "none" };
  readonly stream: false;
}

/**
 * Le paramètre qui demande à un modèle raisonneur de **ne pas** raisonner.
 *
 * `reasoning.effort` est un paramètre **d'OpenRouter**, pas de la
 * spécification `/chat/completions` : c'est la passerelle qui le traduit vers
 * chaque fournisseur. Il n'est donc envoyé qu'à OpenRouter — un serveur
 * générique (`openai_compatible`) ou Mistral le refuserait comme un champ
 * inconnu, et on transformerait un appel qui marche en 400.
 *
 * Pourquoi le poser : voir `spentOnReasoning`. Avec 2 000 à 3 000 jetons de
 * budget, un modèle raisonneur les dépense en réflexion et ne rend rien. Le
 * coach et la routine ne demandent pas une démonstration, ils demandent un
 * JSON court — le raisonnement interne n'a rien à y apporter que du silence.
 * Les modèles dont le fournisseur rend le raisonnement obligatoire ignorent ce
 * champ ; pour ceux-là, `spentOnReasoning` reste la seule réponse, et elle est
 * un message, pas une réparation.
 */
const NO_REASONING = { effort: "none" } as const;

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
    ...(config.provider === "openrouter" ? { reasoning: NO_REASONING } : {}),
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

/**
 * Cet échec est-il **notre** délai qui a expiré ?
 *
 * `AbortSignal.timeout` lève une `TimeoutError`, `AbortController.abort()` une
 * `AbortError` : les deux sont notre horloge, pas une panne du fournisseur, et
 * la nuance décide du message affiché. Exporté parce que l'adaptateur ChatGPT
 * pose exactement la même question.
 */
export function timedOut(cause: unknown): boolean {
  return cause instanceof Error && /abort|timeout/i.test(cause.name);
}

/* ------------------------------------------------------------------ */
/* Partage du délai entre l'appel et la lecture                        */
/* ------------------------------------------------------------------ */

/**
 * Part du délai laissée à l'**établissement** de la réponse (jusqu'aux
 * en-têtes) ; le reste va à la lecture du corps.
 *
 * Le calcul, parce qu'il doit rester vérifiable — et parce qu'un incident réel
 * l'a rendu nécessaire. Un modèle lent d'OpenRouter (souvent un `:free`) répond
 * `200` en quelques secondes, puis met une minute à écrire. Avec un délai
 * unique attaché au `fetch`, l'abandon tombait **pendant la lecture** : le
 * `response.json()` échouait, l'adaptateur classait cela en `malformed`, et
 * l'utilisateur lisait « Le coach est injoignable » — trois affirmations
 * fausses d'affilée.
 *
 * Le budget total ne bouge pas (`timeoutMs` reste le contrat du port, et
 * `maxDuration` reste ce qu'il est : 60 s pour le coach comme pour la routine).
 * Ce qui change, c'est sa **répartition** : un serveur qui n'a pas rendu ses
 * en-têtes après 35 % du budget ne les rendra pas, tandis qu'un serveur qui a
 * commencé à écrire mérite les 65 % restants pour finir. Sur le coach
 * (`MODEL_TIMEOUT_MS = 45 s`, soit 15 s de marge sous `maxDuration`), cela fait
 * ~15,7 s pour l'appel et ~29,3 s pour la génération. Aucune addition ne
 * dépasse `timeoutMs` : la lecture n'a pas un délai à elle, elle a **ce qui
 * reste** avant la même échéance.
 */
const CONNECT_SHARE = 0.35;

/** Le délai accordé à l'établissement de la réponse, pour un budget donné. */
export function connectBudget(timeoutMs: number): number {
  return Math.max(1, Math.round(timeoutMs * CONNECT_SHARE));
}

/**
 * Une échéance unique, dont l'abandon frappe d'abord l'appel puis la lecture.
 *
 * Un seul `AbortController` pour les deux phases : c'est lui qui coupe aussi le
 * flux du corps, ce qu'un signal rendu au seul `fetch` ne saurait pas faire une
 * fois les en-têtes reçus.
 */
function startDeadline(timeoutMs: number): {
  readonly signal: AbortSignal;
  /** Passe à la phase de lecture, avec ce qui reste du budget. */
  readonly toRead: () => void;
  readonly done: () => void;
} {
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  const arm = (ms: number, message: string): ReturnType<typeof setTimeout> =>
    setTimeout(() => controller.abort(new DOMException(message, "TimeoutError")), Math.max(0, ms));

  let timer = arm(connectBudget(timeoutMs), "délai d'appel dépassé");

  return {
    signal: controller.signal,
    toRead: () => {
      clearTimeout(timer);
      timer = arm(deadline - Date.now(), "délai de lecture dépassé");
    },
    done: () => clearTimeout(timer),
  };
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
      const deadline = startDeadline(timeoutMs);
      let response: Response;

      try {
        response = await fetchImpl(endpoint.url, {
          method: "POST",
          headers: endpoint.headers,
          body: JSON.stringify(buildBody(config, request, messages, tokenField)),
          // Voir le traitement des 3xx plus bas : l'URL a été vérifiée, la
          // suite d'une chaîne de redirections ne le serait pas.
          redirect: "manual",
          signal: deadline.signal,
        });
      } catch (cause) {
        deadline.done();
        throw new ModelError(
          timedOut(cause) ? "timeout" : "unreachable",
          config,
          "appel impossible",
          null,
          cause,
        );
      }

      // Les en-têtes sont là : la lecture du corps prend le reste du budget.
      deadline.toRead();
      try {
        // Une redirection n'est pas suivie, et n'est pas non plus traitée comme
        // une erreur ordinaire : `checkBaseUrl` a validé **cette** adresse, pas
        // celle que le serveur distant désignerait ensuite. Sans ce refus, un
        // hôte public autorisé pourrait renvoyer 302 vers 169.254.169.254 et
        // faire porter l'appel à notre fonction — la vérification d'URL ne
        // vaudrait plus que pour le premier maillon de la chaîne.
        if (isRedirect(response.status)) {
          throw new ModelError(
            "redirect",
            config,
            `redirection ${response.status}`,
            response.status,
          );
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
          // La distinction qui manquait : un modèle **trop lent** n'a pas
          // renvoyé une réponse illisible, il n'a pas fini de la renvoyer. Dire
          // « illisible » enverrait l'utilisateur changer de modèle pour cause
          // d'incompatibilité, alors que le sien marche — lentement.
          throw new ModelError(
            timedOut(cause) ? "timeout" : "malformed",
            config,
            timedOut(cause) ? "lecture interrompue" : "réponse illisible",
            response.status,
            cause,
          );
        }

        const text = readChatCompletion(payload);

        if (text === null) {
          // Vide **et** raisonné n'est pas la même chose que vide : le modèle a
          // fonctionné, il a juste tout dépensé avant d'écrire. Le confondre
          // avec `malformed` envoyait chercher une incompatibilité de format
          // là où il n'y a qu'un budget mal réparti.
          throw spentOnReasoning(payload)
            ? new ModelError(
                "reasoning_budget",
                config,
                "budget dépensé en raisonnement",
                response.status,
              )
            : new ModelError("malformed", config, "aucun texte dans la réponse", response.status);
        }
        return text;
      } finally {
        deadline.done();
      }
    }

    // Inatteignable : la boucle rend ou lève à chaque tour. Présent pour que
    // le compilateur n'ait pas à le déduire.
    throw new ModelError("unreachable", config, "aucune tentative aboutie");
  };
}
