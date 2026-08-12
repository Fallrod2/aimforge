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
import { aiRequestSignal, opaqueMessage, transportMessage } from "./ai-http";

/** Échec d'une demande de debrief, porteur d'un message destiné à l'écran. */
export class CoachError extends Error {
  override readonly name = "CoachError";
  /** Statut HTTP, ou `0` si la requête n'a jamais abouti. */
  readonly status: number;
  /** Debriefs restants aujourd'hui, quand la fonction l'a dit (quota atteint). */
  readonly remaining: number | null;
  /**
   * Le debrief qui existe déjà pour ce match (409, SPEC §5 ter bis).
   *
   * Il n'explique pas l'échec, il le rend utile : l'écran peut renvoyer vers le
   * debrief au lieu d'afficher une erreur dont l'utilisateur ne peut rien faire.
   */
  readonly debriefId: number | null;

  constructor(
    message: string,
    status: number,
    remaining: number | null = null,
    debriefId: number | null = null,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.status = status;
    this.remaining = remaining;
    this.debriefId = debriefId;
  }

  /** Le quota du jour est-il épuisé ? L'UI en fait un message, pas une erreur rouge. */
  get quotaReached(): boolean {
    return this.status === 429;
  }

  /** Ce match est-il déjà débriefé ? Ce n'est pas une panne, c'est un état. */
  get alreadyDebriefed(): boolean {
    return this.status === 409;
  }
}

const OFFLINE = "Le coach est injoignable : vérifie ta connexion, puis réessaie.";

const NOT_DEPLOYED =
  "Le coach n'est pas disponible ici : la fonction `/api/coach` n'est pas servie. En local, lance `bunx vercel dev` plutôt que `bun dev`.";

const UNEXPECTED = "Le coach a renvoyé une réponse inattendue. Réessaie dans un instant.";

interface HttpFailure {
  readonly message: string;
  readonly remaining: number | null;
  readonly debriefId: number | null;
}

/** Le message d'un échec HTTP : celui de la fonction si elle en a donné un. */
function errorMessage(status: number, body: string): HttpFailure {
  try {
    const parsed = coachErrorSchema.safeParse(JSON.parse(body));

    if (parsed.success) {
      return {
        message: parsed.data.error,
        remaining: parsed.data.remaining ?? null,
        debriefId: parsed.data.debrief_id ?? null,
      };
    }
  } catch {
    // Corps non-JSON : c'est le cas du 404 servi par Vite en développement,
    // ou d'une page d'erreur de plateforme. On le traite juste en dessous.
  }
  // Un 404 **avec** un corps JSON vient de la fonction (match inconnu) et a été
  // traité au-dessus ; celui-ci vient du serveur de développement.
  return {
    message: opaqueMessage(status, NOT_DEPLOYED, UNEXPECTED),
    remaining: null,
    debriefId: null,
  };
}

/**
 * Demande un debrief. Lève un `CoachError` déjà rédigé en cas d'échec.
 *
 * Le corps est passé tel quel : la fonction accepte **une entrée ou l'autre**
 * (SPEC §5 ter bis), et les deux appelants publics ci-dessous n'en sont que la
 * mise en forme. Le reste — jeton, lecture de l'échec, relecture du contrat —
 * est identique, et il ne doit pas exister en deux exemplaires.
 */
async function postCoach(payload: Record<string, unknown>): Promise<CoachResponse> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (error !== null || token === undefined) {
    throw new CoachError(NO_SESSION_MESSAGE, 401, null, null, error);
  }

  let response: Response;

  try {
    response = await fetch("/api/coach", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      // Plus long que le `maxDuration` de la fonction : voir `./ai-http`.
      signal: aiRequestSignal(),
    });
  } catch (cause) {
    throw new CoachError(transportMessage(cause, OFFLINE), 0, null, null, cause);
  }

  const body = await response.text();

  if (!response.ok) {
    const failure = errorMessage(response.status, body);

    throw new CoachError(failure.message, response.status, failure.remaining, failure.debriefId);
  }

  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(body);
  } catch (cause) {
    throw new CoachError(UNEXPECTED, response.status, null, null, cause);
  }

  const parsed = coachResponseSchema.safeParse(parsedBody);

  if (!parsed.success) {
    throw new CoachError(UNEXPECTED, response.status, null, null, parsed.error);
  }
  return parsed.data;
}

/**
 * Options communes aux deux demandes.
 *
 * `thread` dit **d'où vient le geste**, pas ce qu'il faut afficher : depuis le
 * fil (ou depuis « Débriefer » sur un match, qui y mène), la fonction pose
 * elle-même la carte dans le fil et la rend dans sa réponse. C'est elle qui
 * l'écrit et non le navigateur, parce que la migration 0015 réserve les lignes
 * du coach au serveur.
 */
export interface DebriefOptions {
  readonly thread?: boolean;
}

/**
 * Demande un debrief à partir des stats collées par le joueur.
 *
 * Sans `thread`, le debrief reste dans l'historique : un collage manuel n'est
 * pas un tour de conversation.
 */
export function requestDebrief(
  stats: string,
  { thread = false }: DebriefOptions = {},
): Promise<CoachResponse> {
  return postCoach({ stats, thread });
}

/**
 * Demande un debrief à partir d'un match importé (SPEC §5 ter bis).
 *
 * Seule la **référence** part : c'est le serveur qui lit le résumé du match en
 * base et le met en texte. Le navigateur n'envoie pas de stats pré-formatées,
 * sinon il suffirait de mentir sur le contenu du match.
 */
export function requestDebriefForMatch(
  matchId: string,
  { thread = false }: DebriefOptions = {},
): Promise<CoachResponse> {
  return postCoach({ match_id: matchId, thread });
}
