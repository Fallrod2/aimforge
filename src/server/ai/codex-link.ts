/**
 * La machine d'état de la liaison ChatGPT (abonnement) — SPEC §5 ter.
 *
 * Entre le flux d'OpenAI (`codex-oauth.ts`) et la fonction serverless, il reste
 * trois décisions qui n'ont rien de réseau et tout de produit : quel jeton
 * opaque on rend, quel message on affiche à un échec d'initialisation, et ce
 * qu'on écrit quand l'autorisation aboutit. Elles vivent ici, en module pur —
 * `api/ai-settings.ts` ne fait plus que brancher des tuyaux, et cette machine
 * se teste sans compte ChatGPT, sans base et sans HTTP.
 *
 * Ce module ne persiste rien lui-même : il rend le groupe de jetons **déjà
 * sérialisé**, et c'est la fonction qui l'écrit. La raison est la même que
 * partout ailleurs dans `src/server/` — un module pur ne connaît pas Supabase.
 */

import type { AiLinkStart } from "../../shared/ai-settings-contract.js";
import { openHandle, sealHandle } from "./codex-handle.js";
import {
  DEVICE_EXPIRES_IN_SECONDS,
  pollDeviceAuth,
  startDeviceAuth,
  VERIFICATION_URI,
} from "./codex-oauth.js";
import { serializeTokenBundle } from "./codex-tokens.js";
import type { FetchLike } from "./openai-compatible.js";

/** Ce dont la machine a besoin, et qu'elle ne va pas chercher elle-même. */
export interface LinkDeps {
  /** La clé de scellement du jeton opaque (voir `codex-handle.ts`). */
  readonly secret: string;
  readonly fetchImpl?: FetchLike;
  /** L'heure, injectable : une échéance se teste, elle ne s'attend pas. */
  readonly now?: number;
}

export const DEVICE_AUTH_DISABLED =
  "La connexion par code n'est pas activée sur ton compte ChatGPT. Ouvre chatgpt.com → Réglages → Sécurité, active la connexion par code d'appareil, puis réessaie.";

export const START_UNAVAILABLE =
  "OpenAI n'a pas pu ouvrir la demande d'autorisation. Réessaie dans un instant.";

export type StartOutcome =
  | { readonly ok: true; readonly link: AiLinkStart }
  /**
   * `status` dit **à qui appartient le problème**, comme partout ailleurs :
   * 503 quand c'est un réglage du compte ChatGPT (l'utilisateur peut agir),
   * 502 quand OpenAI est en peine (personne ne peut rien, sauf attendre).
   */
  | { readonly ok: false; readonly reason: string; readonly status: 502 | 503 };

/**
 * Ouvre une demande d'autorisation et rend de quoi la présenter : le code à
 * recopier, la page à ouvrir, et le jeton opaque qui permettra de suivre la
 * suite. Aucun secret ne sort d'ici.
 */
export async function startLink(userId: string, deps: LinkDeps): Promise<StartOutcome> {
  const started = await startDeviceAuth(deps.fetchImpl ?? fetch);

  if (!started.ok) {
    if (started.kind === "disabled") {
      return { ok: false, reason: DEVICE_AUTH_DISABLED, status: 503 };
    }
    // Le statut d'OpenAI reste dans les logs de l'appelant : à l'écran il
    // n'apprendrait rien à personne.
    return { ok: false, reason: START_UNAVAILABLE, status: 502 };
  }

  const handle = sealHandle(
    {
      deviceAuthId: started.start.deviceAuthId,
      userCode: started.start.userCode,
      userId,
    },
    deps.secret,
    deps.now ?? Date.now(),
  );

  return {
    ok: true,
    link: {
      userCode: started.start.userCode,
      verificationUri: VERIFICATION_URI,
      expiresIn: DEVICE_EXPIRES_IN_SECONDS,
      handle,
    },
  };
}

export type PollOutcome =
  | { readonly status: "pending" }
  | { readonly status: "expired" }
  | { readonly status: "denied" }
  /** `bundle` est le JSON à écrire dans `ai_settings.api_key`. Jamais rendu au client. */
  | { readonly status: "linked"; readonly bundle: string };

/**
 * Où en est l'autorisation.
 *
 * Un jeton opaque illisible, périmé, ou présenté par quelqu'un d'autre donne
 * `expired` — et non une erreur : du point de vue de l'utilisateur, le geste à
 * faire est le même (recommencer), et distinguer les trois cas dans la réponse
 * ne renseignerait qu'un attaquant.
 */
export async function pollLink(
  userId: string,
  handle: string,
  deps: LinkDeps,
): Promise<PollOutcome> {
  const now = deps.now ?? Date.now();
  const opened = openHandle(handle, userId, deps.secret, now);

  if (opened === null) return { status: "expired" };

  const polled = await pollDeviceAuth(opened, deps.fetchImpl ?? fetch, now);

  if (polled.status === "linked") {
    return { status: "linked", bundle: serializeTokenBundle(polled.tokens) };
  }
  return { status: polled.status };
}
