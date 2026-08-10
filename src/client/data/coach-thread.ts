/**
 * Le fil du coach côté données (`public.coach_thread_messages`, migration 0014,
 * SPEC §5 sexies).
 *
 * **Ce module ne contient aucune écriture de message, et c'est le point qui
 * compte.** Depuis la migration 0015, le navigateur ne peut plus écrire qu'une
 * ligne `role = 'user'` — et même celle-là, il ne l'écrit pas d'ici : elle part
 * avec la question, dans `api/coach-thread`, sous le JWT de l'utilisateur. Les
 * lignes du coach (réponses et cartes debrief) sont réservées au serveur, sous
 * la service key : une réplique de coach écrite depuis le navigateur serait
 * relue au tour suivant comme un vrai tour assistant.
 *
 * Ce qui reste ici, ce sont les trois accès qui n'ont besoin d'aucun secret et
 * qu'aucune fonction serverless n'améliorerait :
 *
 * - **lire le fil** — une simple liste, filtrée par la RLS ;
 * - **savoir s'il y a quelque chose à débriefer** — avant de proposer le geste,
 *   pour ne pas envoyer l'utilisateur chercher un 404 ;
 * - **effacer le fil** — supprimer ses propres lignes est un geste que la RLS
 *   autorise, et qui n'a rien à faire dans une fonction.
 */

import { type ThreadMessage, threadRoleSchema } from "../../shared/coach-thread-contract";
import { supabase } from "../supabase/client";
import { queryError } from "./errors";
import { type MatchSummary, matchSummarySchema } from "./linked-accounts-contract";
import { currentUserId } from "./session";

const COLUMNS = "id, role, content, debrief_id, created_at";

/**
 * Messages relus dans le fil.
 *
 * Plus large que ce que le modèle reçoit en contexte (30) : l'écran affiche le
 * fil entier, c'est le prompt qui se limite aux derniers tours.
 */
const THREAD_LIMIT = 200;

/** La forme des colonnes lues, avant validation. */
interface ThreadRow {
  readonly id: number;
  readonly role: string;
  readonly content: string;
  readonly debrief_id: number | null;
  readonly created_at: string;
}

/**
 * Une ligne relue → un message affichable, ou `null` si le rôle n'est pas l'un
 * des deux attendus.
 *
 * La contrainte `check` de la migration 0014 rend ce cas impossible ; s'il
 * existait, afficher un message sans savoir qui parle serait pire que de ne pas
 * l'afficher.
 */
function toMessage(row: ThreadRow): ThreadMessage | null {
  const role = threadRoleSchema.safeParse(row.role);

  if (!role.success) return null;

  const time = Date.parse(row.created_at);

  return {
    id: row.id,
    role: role.data,
    content: row.content,
    debriefId: row.debrief_id,
    createdAt: Number.isNaN(time) ? row.created_at : new Date(time).toISOString(),
  };
}

/**
 * Le fil, du plus ancien au plus récent.
 *
 * Le tri est sur `id` et non sur `created_at` : la question et la réponse d'un
 * même tour sont insérées dans la même instruction et partagent la
 * milliseconde, seul l'identifiant, monotone, dit laquelle a été dite en
 * premier.
 *
 * Le filtre `user_id` est redondant avec la RLS : il est là pour que la requête
 * emprunte l'index `(user_id, id)`.
 */
export async function listThreadMessages(): Promise<readonly ThreadMessage[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("coach_thread_messages")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("id", { ascending: true })
    .limit(THREAD_LIMIT);

  if (error !== null || data === null) {
    throw queryError(error, "Le fil du coach n'a pas pu être chargé.");
  }
  return data.flatMap((row) => {
    const message = toMessage(row);

    return message === null ? [] : [message];
  });
}

/**
 * Le dernier match importé qui n'a pas encore de debrief, ou `null`.
 *
 * C'est ce que vise la question préconstruite « Analyse mon dernier match » : le
 * client a besoin de savoir **s'il y a quelque chose à débriefer** avant de
 * proposer le geste, sinon le clic partirait chercher un 404.
 *
 * Deux lectures et non une jointure : PostgREST ne joint pas deux tables sans
 * clé étrangère déclarée, et il n'y en a pas entre `debriefs.match_id` (la
 * référence du fournisseur) et `imported_matches` (le cache) — c'est délibéré,
 * la migration 0011 explique pourquoi. Le coût reste d'un aller-retour de plus
 * sur dix lignes.
 *
 * Les deux `user_id` sont redondants avec la RLS : ils font emprunter les index.
 */
export async function lastUndebriefedMatch(limit = 10): Promise<MatchSummary | null> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from("imported_matches")
    .select("match_id, payload")
    .eq("user_id", userId)
    .order("played_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (error !== null || data === null) {
    throw queryError(error, "Tes matchs importés n'ont pas pu être lus.");
  }
  if (data.length === 0) return null;

  const { data: debriefed, error: debriefsError } = await supabase
    .from("debriefs")
    .select("match_id")
    .eq("user_id", userId)
    .in(
      "match_id",
      data.map((row) => row.match_id),
    );

  if (debriefsError !== null || debriefed === null) {
    throw queryError(debriefsError, "Tes debriefs n'ont pas pu être lus.");
  }

  const done = new Set(debriefed.flatMap((row) => (row.match_id === null ? [] : [row.match_id])));

  for (const row of data) {
    if (done.has(row.match_id)) continue;

    // Un `payload` hors contrat est écarté : le serveur refuserait de le
    // débriefer (422), et proposer le geste serait promettre un échec.
    const parsed = matchSummarySchema.safeParse(row.payload);

    if (parsed.success) return parsed.data;
  }
  return null;
}

/**
 * Efface le fil entier.
 *
 * Les debriefs référencés **survivent** : la clé étrangère est en
 * `on delete set null` dans l'autre sens (supprimer un debrief ne troue pas le
 * fil), et ici on ne touche qu'aux messages. L'historique des debriefs reste
 * donc intact sous le fil — c'est ce que la confirmation annonce.
 */
export async function clearThread(): Promise<void> {
  const userId = await currentUserId();
  const { error } = await supabase.from("coach_thread_messages").delete().eq("user_id", userId);

  if (error !== null) throw queryError(error, "Le fil n'a pas pu être effacé.");
}
