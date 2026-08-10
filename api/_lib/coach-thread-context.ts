/**
 * Le contexte propre au **fil du coach** (SPEC §5 sexies) : les derniers matchs
 * importés, les derniers debriefs, et les derniers messages du fil.
 *
 * Le profil et le dernier bench ne sont pas ici : ils sont déjà partagés par
 * les trois fonctions du coach (`./coach-context.ts`), et les recopier aurait
 * fait dériver le palier retenu — donc la liste des scénarios autorisés.
 *
 * Les deux règles de `./coach-context.ts` valent ici aussi, et pour les mêmes
 * raisons :
 *
 * 1. **la lecture passe par le client de l'appelant**, jamais par la service
 *    key. La RLS s'applique exactement comme dans le navigateur ;
 * 2. **une lecture qui échoue rend une liste vide**. Tout ce que ce module rend
 *    est du *contexte* : le faire échouer annulerait une requête dont le quota
 *    est déjà consommé, pour une réponse qui aurait juste été un peu moins
 *    précise.
 *
 * Le préfixe `_` sort ce fichier du routage Vercel : il est importé, jamais
 * appelé en HTTP.
 */

import {
  type MatchSummary,
  matchSummarySchema,
} from "../../src/client/data/linked-accounts-contract.js";
import type { ThreadDebrief, ThreadTurn } from "../../src/server/coach/thread-prompt.js";
import { coachDebriefSchema } from "../../src/shared/coach-contract.js";
import {
  THREAD_DEBRIEFS_SIZE,
  THREAD_HISTORY_SIZE,
  THREAD_MATCHES_SIZE,
  threadRoleSchema,
} from "../../src/shared/coach-thread-contract.js";
import type { CoachUserClient } from "./coach-context.js";

/** Les matchs récents, plus la référence du dernier qui n'a pas été débriefé. */
export interface ThreadMatches {
  readonly summaries: readonly MatchSummary[];
  /**
   * Le match que le bouton « générer un debrief » viserait, ou `null`.
   *
   * Choisi **par le serveur** et jamais par le modèle : lui laisser désigner un
   * identifiant, c'est l'inviter à en inventer un.
   */
  readonly undebriefedMatchId: string | null;
}

const NO_MATCHES: ThreadMatches = { summaries: [], undebriefedMatchId: null };

/**
 * Les derniers matchs importés, du plus récent au plus ancien, et le premier
 * d'entre eux qui n'a pas encore de debrief.
 *
 * `payload` est un `jsonb` : Postgres n'en garantit que la syntaxe. Une ligne
 * hors contrat est **écartée** plutôt que rendue en morceaux — le fil perd une
 * partie de son contexte, il ne raconte pas n'importe quoi.
 *
 * Le tri est sur `played_at` puis `id` : deux matchs importés dans la même
 * seconde doivent quand même s'ordonner, et une partie sans date connue ne doit
 * pas remonter en tête (`nullsFirst: false`).
 */
export async function loadRecentMatches(
  client: CoachUserClient,
  userId: string,
): Promise<ThreadMatches> {
  const { data, error } = await client
    .from("imported_matches")
    .select("match_id, payload")
    .eq("user_id", userId)
    .order("played_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(THREAD_MATCHES_SIZE);

  if (error !== null || data === null) {
    if (error !== null) console.error("[coach-thread] lecture des matchs en échec", error);
    return NO_MATCHES;
  }

  const summaries: MatchSummary[] = [];
  const matchIds: string[] = [];

  for (const row of data) {
    const parsed = matchSummarySchema.safeParse(row.payload);

    if (!parsed.success) continue;
    summaries.push(parsed.data);
    matchIds.push(row.match_id);
  }

  return { summaries, undebriefedMatchId: await firstUndebriefed(client, userId, matchIds) };
}

/**
 * Le premier de ces matchs (donc le plus récent) qui n'a pas encore de debrief.
 *
 * Une seule requête pour les cinq, filtrée sur la liste : c'est l'index unique
 * `(user_id, match_id)` de la migration 0011 qui répond, et cinq allers-retours
 * pour cinq identifiants seraient cinq fois trop.
 */
async function firstUndebriefed(
  client: CoachUserClient,
  userId: string,
  matchIds: readonly string[],
): Promise<string | null> {
  if (matchIds.length === 0) return null;

  const { data, error } = await client
    .from("debriefs")
    .select("match_id")
    .eq("user_id", userId)
    .in("match_id", [...matchIds]);

  // Une lecture en échec ne fait pas disparaître la proposition : elle la
  // retire, ce qui est le côté prudent — proposer un debrief déjà fait rendrait
  // un 409 après un clic, et un clic qui échoue est pire qu'un bouton absent.
  if (error !== null || data === null) {
    if (error !== null)
      console.error("[coach-thread] lecture des debriefs de match en échec", error);
    return null;
  }

  const debriefed = new Set(data.flatMap((row) => (row.match_id === null ? [] : [row.match_id])));

  return matchIds.find((matchId) => !debriefed.has(matchId)) ?? null;
}

/**
 * Les derniers debriefs, réduits à ce qui situe le conseil : résumé, titres des
 * axes, focus.
 *
 * Les colonnes `jsonb` sont revalidées avec le schéma qui les a écrites ; une
 * ligne dérivée est écartée plutôt que donnée au modèle en fragments.
 */
export async function loadRecentDebriefs(
  client: CoachUserClient,
  userId: string,
): Promise<readonly ThreadDebrief[]> {
  const { data, error } = await client
    .from("debriefs")
    .select("date, resume, points_forts, axes, focus")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .order("id", { ascending: false })
    .limit(THREAD_DEBRIEFS_SIZE);

  if (error !== null || data === null) {
    if (error !== null) console.error("[coach-thread] lecture des debriefs en échec", error);
    return [];
  }

  const debriefs: ThreadDebrief[] = [];

  for (const row of data) {
    const parsed = coachDebriefSchema.safeParse({
      resume: row.resume,
      points_forts: row.points_forts,
      axes: row.axes,
      focus: row.focus,
    });

    if (!parsed.success) continue;
    debriefs.push({
      date: new Date(row.date).toISOString(),
      resume: parsed.data.resume,
      axes: parsed.data.axes.map((axe) => axe.titre),
      focus: parsed.data.focus,
    });
  }
  return debriefs;
}

/**
 * Les derniers messages du fil, du plus ancien au plus récent.
 *
 * Lus en ordre **décroissant** puis retournés : c'est la fin de la conversation
 * qui compte, et un `limit` sur un tri croissant rendrait le début.
 */
export async function loadThreadHistory(
  client: CoachUserClient,
  userId: string,
): Promise<readonly ThreadTurn[]> {
  const { data, error } = await client
    .from("coach_thread_messages")
    .select("role, content")
    .eq("user_id", userId)
    .order("id", { ascending: false })
    .limit(THREAD_HISTORY_SIZE);

  if (error !== null || data === null) {
    if (error !== null) console.error("[coach-thread] lecture du fil en échec", error);
    return [];
  }

  const turns: ThreadTurn[] = [];

  for (const row of data) {
    const role = threadRoleSchema.safeParse(row.role);

    // Un rôle hors des deux valeurs attendues ne peut pas exister (contrainte
    // `check` de la migration 0014) ; s'il existait, l'ignorer vaut mieux que
    // le donner au modèle sans savoir qui parle.
    if (role.success) turns.push({ role: role.data, content: row.content });
  }
  return turns.reverse();
}
