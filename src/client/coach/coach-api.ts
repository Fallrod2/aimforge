/**
 * Appel de la fonction serverless `POST /api/coach`.
 *
 * C'est le seul endroit du bundle qui parle à une API HTTP : tout le reste du
 * client va directement à Postgres. La raison est unique et suffisante — la
 * clé Anthropic ne peut pas exister dans un navigateur.
 *
 * Le JWT de la session est joint à la main (`Authorization: Bearer`) : la
 * fonction n'est pas Supabase, elle ne reçoit rien automatiquement. C'est ce
 * jeton qu'elle vérifie, puis avec lequel elle relit le profil et le bench,
 * sous la RLS de l'utilisateur.
 *
 * Chaque échec devient une phrase affichable. Y compris celui qui arrivera à
 * coup sûr en développement local : `bun dev` ne sert que le client, il n'y a
 * aucune fonction derrière `/api/coach` — il faut `bunx vercel dev`.
 */

import {
  type CoachResponse,
  coachErrorSchema,
  coachResponseSchema,
} from "../../shared/coach-contract";
import { NO_SESSION_MESSAGE } from "../data/errors";
import { supabase } from "../supabase/client";

/** Échec d'une demande de debrief, porteur d'un message destiné à l'écran. */
export class CoachError extends Error {
  override readonly name = "CoachError";
  /** Statut HTTP, ou `0` si la requête n'a jamais abouti. */
  readonly status: number;
  /** Debriefs restants aujourd'hui, quand la fonction l'a dit (quota atteint). */
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

const OFFLINE = "Le coach est injoignable : vérifie ta connexion, puis réessaie.";

const NOT_DEPLOYED =
  "Le coach n'est pas disponible ici : la fonction `/api/coach` n'est pas servie. En local, lance `bunx vercel dev` plutôt que `bun dev`.";

const UNEXPECTED = "Le coach a renvoyé une réponse inattendue. Réessaie dans un instant.";

/** Le message d'un échec HTTP : celui de la fonction si elle en a donné un. */
function errorMessage(status: number, body: string): { message: string; remaining: number | null } {
  try {
    const parsed = coachErrorSchema.safeParse(JSON.parse(body));

    if (parsed.success) {
      return { message: parsed.data.error, remaining: parsed.data.remaining ?? null };
    }
  } catch {
    // Corps non-JSON : c'est le cas du 404 servi par Vite en développement,
    // ou d'une page d'erreur de plateforme. On le traite juste en dessous.
  }
  return { message: status === 404 ? NOT_DEPLOYED : UNEXPECTED, remaining: null };
}

/** Demande un debrief. Lève un `CoachError` déjà rédigé en cas d'échec. */
export async function requestDebrief(stats: string): Promise<CoachResponse> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (error !== null || token === undefined) {
    throw new CoachError(NO_SESSION_MESSAGE, 401, null, error);
  }

  let response: Response;

  try {
    response = await fetch("/api/coach", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ stats }),
    });
  } catch (cause) {
    throw new CoachError(OFFLINE, 0, null, cause);
  }

  const body = await response.text();

  if (!response.ok) {
    const { message, remaining } = errorMessage(response.status, body);

    throw new CoachError(message, response.status, remaining);
  }

  let payload: unknown;

  try {
    payload = JSON.parse(body);
  } catch (cause) {
    throw new CoachError(UNEXPECTED, response.status, null, cause);
  }

  const parsed = coachResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new CoachError(UNEXPECTED, response.status, null, parsed.error);
  }
  return parsed.data;
}
