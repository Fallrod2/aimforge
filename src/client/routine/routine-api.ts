/**
 * Appel de la fonction serverless `POST /api/routine`.
 *
 * Jumeau de `../coach/coach-api.ts`, pour la même raison unique et suffisante :
 * la clé Anthropic ne peut pas exister dans un navigateur. Tout le reste du
 * client va directement à Postgres.
 *
 * Le JWT de la session est joint à la main (`Authorization: Bearer`) : la
 * fonction n'est pas Supabase, elle ne reçoit rien automatiquement. C'est ce
 * jeton qu'elle vérifie, puis avec lequel elle relit le bench et les debriefs,
 * sous la RLS de l'utilisateur.
 *
 * Chaque échec devient une phrase affichable. Y compris celui qui arrivera à
 * coup sûr en développement local : `bun dev` ne sert que le client, il n'y a
 * aucune fonction derrière `/api/routine` — il faut `bunx vercel dev`.
 */

import {
  type RoutineResponse,
  routineErrorSchema,
  routineResponseSchema,
} from "../../shared/routine-contract";
import { aiRequestSignal, opaqueMessage, transportMessage } from "../coach/ai-http";
import { NO_SESSION_MESSAGE } from "../data/errors";
import { supabase } from "../supabase/client";

/** Échec d'une demande de routine, porteur d'un message destiné à l'écran. */
export class RoutineApiError extends Error {
  override readonly name = "RoutineApiError";
  /** Statut HTTP, ou `0` si la requête n'a jamais abouti. */
  readonly status: number;
  /** Routines restantes aujourd'hui, quand la fonction l'a dit (quota atteint). */
  readonly remaining: number | null;

  constructor(message: string, status: number, remaining: number | null = null, cause?: unknown) {
    super(message, { cause });
    this.status = status;
    this.remaining = remaining;
  }

  /** Le quota du jour est-il épuisé ? L'UI en fait un message, pas une erreur rouge. */
  get quotaReached(): boolean {
    return this.status === 429;
  }
}

const OFFLINE = "La génération est injoignable : vérifie ta connexion, puis réessaie.";

const NOT_DEPLOYED =
  "La routine n'est pas disponible ici : la fonction `/api/routine` n'est pas servie. En local, lance `bunx vercel dev` plutôt que `bun dev`.";

const UNEXPECTED = "La génération a renvoyé une réponse inattendue. Réessaie dans un instant.";

/** Le message d'un échec HTTP : celui de la fonction si elle en a donné un. */
function errorMessage(status: number, body: string): { message: string; remaining: number | null } {
  try {
    const parsed = routineErrorSchema.safeParse(JSON.parse(body));

    if (parsed.success) {
      return { message: parsed.data.error, remaining: parsed.data.remaining ?? null };
    }
  } catch {
    // Corps non-JSON : c'est le cas du 404 servi par Vite en développement,
    // ou d'une page d'erreur de plateforme. On le traite juste en dessous.
  }
  return { message: opaqueMessage(status, NOT_DEPLOYED, UNEXPECTED), remaining: null };
}

/** Demande une routine. Lève un `RoutineApiError` déjà rédigé en cas d'échec. */
export async function requestRoutine(
  dureeMinutes: number,
  focus: string | null,
): Promise<RoutineResponse> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (error !== null || token === undefined) {
    throw new RoutineApiError(NO_SESSION_MESSAGE, 401, null, error);
  }

  let response: Response;

  try {
    response = await fetch("/api/routine", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ duree_minutes: dureeMinutes, focus }),
      // Le délai est plus long que le `maxDuration` de la fonction : il ne
      // coupe pas la génération, il met fin à une attente que plus rien ne
      // terminerait (`../coach/ai-http`).
      signal: aiRequestSignal(),
    });
  } catch (cause) {
    throw new RoutineApiError(transportMessage(cause, OFFLINE), 0, null, cause);
  }

  const body = await response.text();

  if (!response.ok) {
    const { message, remaining } = errorMessage(response.status, body);

    throw new RoutineApiError(message, response.status, remaining);
  }

  let payload: unknown;

  try {
    payload = JSON.parse(body);
  } catch (cause) {
    throw new RoutineApiError(UNEXPECTED, response.status, null, cause);
  }

  const parsed = routineResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new RoutineApiError(UNEXPECTED, response.status, null, parsed.error);
  }
  return parsed.data;
}
