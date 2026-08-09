/**
 * L'adaptateur **expérimental** ChatGPT (abonnement) — SPEC §5 ter.
 *
 * ⚠️ Ce chemin n'est pas une API publique. Il parle au back-end que le client
 * Codex d'OpenAI utilise pour lui-même, avec les **jetons d'une liaison de
 * compte** (flux d'autorisation par code, `codex-oauth.ts`) au lieu d'une clé
 * d'API. Rien de tout cela n'est contractuel :
 *
 * - l'URL, la forme du corps et celle des évènements peuvent changer sans
 *   préavis, et le feront ;
 * - le jeton d'accès dure quelques heures. Il est **rafraîchi ici**, sans que
 *   l'utilisateur ait rien à faire — tant qu'OpenAI accepte le jeton de
 *   rafraîchissement. Quand il le refuse, la liaison est morte et il faut
 *   relier : c'est le seul geste que l'écran demande ;
 * - l'accès peut être filtré par OpenAI (protection anti-robot) ; une IP de
 *   fonction serverless est un candidat de choix ;
 * - les limites de l'abonnement s'appliquent, et elles ne sont pas les mêmes
 *   que celles d'une clé d'API.
 *
 * D'où quatre précautions, qui sont la raison d'être de ce fichier :
 *
 * 1. **tout est ici** : URL, en-têtes, forme du corps, lecture du flux. Le
 *    jour où OpenAI déplace quelque chose, on édite ce fichier et rien
 *    d'autre ;
 * 2. **la lecture est tolérante** : on cherche le texte là où il est
 *    raisonnablement susceptible d'être, plutôt que d'exiger une forme exacte
 *    d'un protocole non documenté ;
 * 3. **le rafraîchissement est enregistré** : le groupe de jetons renouvelé
 *    est réécrit dans `ai_settings.api_key` (sous service role, par la fonction
 *    appelante) ; sinon chaque appel rafraîchirait à nouveau, et la rotation du
 *    jeton de rafraîchissement finirait par casser la liaison ;
 * 4. **l'échec est rédigé** : il remonte comme n'importe quel `ModelError`,
 *    donc l'utilisateur lit « relie ton compte ChatGPT » et non une trace
 *    technique.
 *
 * Aucune de ces lignes ne journalise un jeton : les seuls `console.error` de ce
 * fichier portent un statut HTTP et, au pire, un extrait du corps d'erreur
 * d'OpenAI.
 *
 * L'écran de réglages affiche le badge « Expérimental » et l'avertissement :
 * l'utilisateur choisit ce chemin en connaissance de cause, ou pas du tout.
 */

import { mergeTokens, refreshTokens } from "./codex-oauth.js";
import {
  type CodexTokens,
  hasExpired,
  needsRefresh,
  parseTokenBundle,
  serializeTokenBundle,
} from "./codex-tokens.js";
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
 * Les deux en-têtes que le back-end Codex exige en plus de l'autorisation. Ils
 * ne sont documentés nulle part : ils viennent du client officiel, et sans eux
 * l'appel est refusé.
 */
const ORIGINATOR = "codex_cli_rs";
const OPENAI_BETA = "responses=experimental";

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
  // 401 et 403 sont le cas courant, et il a une cause banale : la liaison a été
  // révoquée ou n'est plus honorée. Le geste à faire est de relier son compte.
  if (status === 401 || status === 403)
    return new ModelError("auth", config, "liaison refusée", status);
  if (status === 429) return new ModelError("rate_limit", config, "limite d'abonnement", status);
  if (status === 400 || status === 404 || status === 422) {
    return new ModelError("request", config, `requête refusée (${status})`, status);
  }
  return new ModelError("unreachable", config, `statut ${status}`, status);
}

/* ------------------------------------------------------------------ */
/* Jetons : lecture, rafraîchissement, réécriture                      */
/* ------------------------------------------------------------------ */

/** Ce que l'adaptateur ne va pas chercher lui-même. */
export interface ChatGptDeps {
  readonly fetchImpl?: FetchLike;
  /**
   * Réécriture du groupe de jetons dans `ai_settings.api_key`, **sous service
   * role** : c'est le seul rôle qui puisse écrire au nom de quelqu'un d'autre,
   * et l'appelant a déjà identifié cette personne par `getUser()`.
   *
   * Facultative : sans elle, le rafraîchissement fonctionne mais n'est pas
   * gardé — l'appel en cours aboutit, le suivant rafraîchira à nouveau.
   */
  readonly persist?: (bundle: string) => Promise<void>;
  /** L'heure, injectable : une expiration se teste, elle ne s'attend pas. */
  readonly now?: number;
}

/** Le message technique d'une liaison morte. Le message d'écran est dans `port.ts`. */
const RELINK = "liaison à refaire";

/**
 * Le jeton d'accès à présenter, rafraîchi si besoin.
 *
 * Trois échecs, trois traitements, et la distinction est ce qui empêche un
 * incident passager de délier tout le monde :
 *
 * - **groupe illisible** (une clé collée du temps de la v1, par exemple) ou
 *   **rafraîchissement refusé** : la liaison est morte → `auth`, et l'écran dit
 *   « relie ton compte » ;
 * - **rafraîchissement en panne** alors que le jeton court encore : on tente
 *   l'appel avec ce qu'on a. Un incident de l'hôte d'authentification ne doit
 *   pas empêcher un debrief que le back-end aurait accepté ;
 * - **rafraîchissement en panne** et jeton déjà expiré : `unreachable`, donc
 *   « réessaie » — la liaison, elle, reste en place.
 */
async function freshTokens(config: ProviderConfig, deps: ChatGptDeps): Promise<CodexTokens> {
  const tokens = parseTokenBundle(config.apiKey);

  if (tokens === null) throw new ModelError("auth", config, `${RELINK} (groupe illisible)`);

  const now = deps.now ?? Date.now();

  if (!needsRefresh(tokens, now)) return tokens;

  if (tokens.refreshToken === null) {
    if (hasExpired(tokens, now)) {
      throw new ModelError("auth", config, `${RELINK} (aucun jeton de rafraîchissement)`);
    }
    return tokens;
  }

  const refreshed = await refreshTokens(tokens.refreshToken, deps.fetchImpl ?? fetch, now);

  if (refreshed.status === "revoked") {
    throw new ModelError("auth", config, `${RELINK} (rafraîchissement refusé)`, 401);
  }
  if (refreshed.status === "error") {
    if (!hasExpired(tokens, now)) return tokens;
    throw new ModelError(
      "unreachable",
      config,
      "rafraîchissement impossible",
      refreshed.httpStatus,
    );
  }

  const merged = mergeTokens(tokens, refreshed.tokens);

  if (deps.persist !== undefined) {
    try {
      await deps.persist(serializeTokenBundle(merged));
    } catch (cause) {
      // L'appel en cours peut continuer : le jeton neuf est en main. Seule la
      // mémoire manque, et c'est un incident d'écriture, pas un refus d'OpenAI.
      // Le message d'erreur de Postgres ne porte pas les valeurs écrites.
      console.error("[ai/chatgpt] jetons rafraîchis non enregistrés", {
        reason: cause instanceof Error ? cause.message.slice(0, 200) : "cause inconnue",
      });
    }
  }
  return merged;
}

export function createChatGptAsk(
  config: ProviderConfig,
  request: ModelRequest,
  deps: ChatGptDeps = {},
): Ask {
  const fetchImpl = deps.fetchImpl ?? fetch;

  return async (messages, timeoutMs) => {
    const tokens = await freshTokens(config, deps);
    let response: Response;

    try {
      response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          authorization: `Bearer ${tokens.accessToken}`,
          "openai-beta": OPENAI_BETA,
          originator: ORIGINATOR,
          // Le back-end exige de savoir **quel** compte de l'abonnement parle.
          ...(tokens.accountId === null ? {} : { "chatgpt-account-id": tokens.accountId }),
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
          // Pas de `max_output_tokens` : ce back-end valide une liste stricte de
          // paramètres et répond 400 « Unsupported parameter » dessus (vérifié
          // en réel sur engram, 14/07/2026). Le prompt borne déjà la longueur.
          //
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
