/**
 * Appel de la fonction serverless `POST /api/coach-thread` (SPEC §5 sexies).
 *
 * Jumeau de `./coach-api.ts`, pour la même unique raison : la clé du
 * fournisseur ne peut pas exister dans un navigateur. La lecture du fil, elle,
 * ne passe pas par ici — elle va directement à Postgres
 * (`../data/coach-thread.ts`), parce qu'elle n'a besoin d'aucun secret.
 *
 * Le JWT de la session est joint à la main (`Authorization: Bearer`) : la
 * fonction n'est pas Supabase, elle ne reçoit rien automatiquement.
 */

import {
  type ThreadResponse,
  threadErrorSchema,
  threadResponseSchema,
} from "../../shared/coach-thread-contract";
import { NO_SESSION_MESSAGE } from "../data/errors";
import { supabase } from "../supabase/client";
import { aiRequestSignal, opaqueMessage, transportMessage } from "./ai-http";

/** Échec d'un message au coach, porteur d'un message destiné à l'écran. */
export class ThreadError extends Error {
  override readonly name = "ThreadError";
  /** Statut HTTP, ou `0` si la requête n'a jamais abouti. */
  readonly status: number;
  /** Messages restants aujourd'hui, quand la fonction l'a dit. */
  readonly remaining: number | null;

  constructor(message: string, status: number, remaining: number | null = null, cause?: unknown) {
    super(message, { cause });
    this.status = status;
    this.remaining = remaining;
  }

  /** Le quota du jour est-il épuisé ? L'UI en fait un message, pas une alerte. */
  get quotaReached(): boolean {
    return this.status === 429;
  }
}

const OFFLINE = "Le coach est injoignable : vérifie ta connexion, puis réessaie.";

const NOT_DEPLOYED =
  "Le fil n'est pas disponible ici : la fonction `/api/coach-thread` n'est pas servie. En local, lance `bunx vercel dev` plutôt que `bun dev`.";

const UNEXPECTED = "Le coach a renvoyé une réponse inattendue. Réessaie dans un instant.";

/** Le message d'un échec HTTP : celui de la fonction si elle en a donné un. */
function errorMessage(status: number, body: string): { message: string; remaining: number | null } {
  try {
    const parsed = threadErrorSchema.safeParse(JSON.parse(body));

    if (parsed.success) {
      return { message: parsed.data.error, remaining: parsed.data.remaining ?? null };
    }
  } catch {
    // Corps non-JSON : le 404 servi par Vite en développement, ou une page
    // d'erreur de plateforme.
  }
  return { message: opaqueMessage(status, NOT_DEPLOYED, UNEXPECTED), remaining: null };
}

/**
 * Envoie un message dans le fil. Lève un `ThreadError` déjà rédigé en cas
 * d'échec.
 *
 * La réponse porte **les deux** messages enregistrés, pas seulement celui du
 * coach : rien n'est persisté quand la génération échoue, donc l'écran ne peut
 * pas ajouter localement ce qu'il vient d'envoyer — il aurait un message
 * fantôme après chaque panne.
 */
export async function requestThreadReply(message: string): Promise<ThreadResponse> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (error !== null || token === undefined) {
    throw new ThreadError(NO_SESSION_MESSAGE, 401, null, error);
  }

  let response: Response;

  try {
    response = await fetch("/api/coach-thread", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ message }),
      // Plus long que le `maxDuration` de la fonction : voir `./ai-http`.
      signal: aiRequestSignal(),
    });
  } catch (cause) {
    throw new ThreadError(transportMessage(cause, OFFLINE), 0, null, cause);
  }

  const body = await response.text();

  if (!response.ok) {
    const failure = errorMessage(response.status, body);

    throw new ThreadError(failure.message, response.status, failure.remaining);
  }

  let payload: unknown;

  try {
    payload = JSON.parse(body);
  } catch (cause) {
    throw new ThreadError(UNEXPECTED, response.status, null, cause);
  }

  const parsed = threadResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new ThreadError(UNEXPECTED, response.status, null, parsed.error);
  }
  return parsed.data;
}
