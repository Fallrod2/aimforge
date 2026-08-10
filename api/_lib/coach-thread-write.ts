/**
 * L'écriture dans le fil du coach, et le partage des rôles entre les deux
 * clients Supabase (SPEC §5 sexies, migration 0015).
 *
 * Depuis la migration 0015, le navigateur ne peut plus écrire qu'une ligne
 * `role = 'user'`, sans référence de debrief et sous 2 000 caractères. Tout le
 * reste — la réponse du coach, les cartes debrief — n'a plus qu'un seul chemin
 * possible : **la service key, ici**. D'où ce module, qui est le seul endroit du
 * projet à écrire une ligne de coach.
 *
 * Les deux règles qu'il tient, et pourquoi elles ne sont pas négociables :
 *
 * 1. **la ligne de l'utilisateur reste sous son JWT.** Elle *peut* passer par la
 *    RLS, donc elle y passe : ce que la base sait vérifier, on ne le lui retire
 *    pas. Seule la ligne du coach emprunte la service key, et seulement parce
 *    qu'aucune policy ne peut l'autoriser sans rouvrir la porte qu'on vient de
 *    fermer ;
 * 2. **ce que la RLS ne vérifie plus, la fonction le vérifie.** La policy de la
 *    0014 s'assurait que le `debrief_id` posé appartenait bien à l'appelant ;
 *    la service key contourne cette garantie, donc `postDebriefCard` refait la
 *    vérification elle-même, **sous le client de l'appelant** — un debrief
 *    invisible pour lui est un debrief qu'on ne référencera pas.
 *
 * Le `user_id` écrit ne vient jamais du corps de la requête : il vient de
 * `getUser(token)`, c'est-à-dire d'une vérification de signature faite par
 * Supabase Auth. C'est le même argument qu'en migration 0007 pour
 * `linked_accounts`, et il vaut ici pour la même raison.
 *
 * Le préfixe `_` sort ce fichier du routage Vercel : il est importé, jamais
 * appelé en HTTP.
 */

import type { StoredDebrief } from "../../src/shared/coach-contract.js";
import type { ThreadMessage } from "../../src/shared/coach-thread-contract.js";
import type { CoachUserClient } from "./coach-context.js";
import type { ServiceClient } from "./service.js";

const COLUMNS = "id, role, content, debrief_id, created_at";

/**
 * Les libellés des demandes de debrief, **écrits par le serveur**.
 *
 * Le client ne les envoie pas, et c'est délibéré : il pourrait écrire cette
 * ligne lui-même (elle est `role = 'user'`), mais la faire transiter par la
 * requête ajouterait une entrée à valider pour un texte qui ne varie qu'entre
 * deux valeurs connues. Une entrée de moins est une forgerie de moins.
 */
export const CARD_REQUEST_LABELS = {
  match: "Analyse ce match.",
  stats: "Analyse cette partie.",
} as const;

export type CardRequestKind = keyof typeof CARD_REQUEST_LABELS;

/** La forme d'une ligne relue juste après l'insertion. */
interface MessageRow {
  readonly id: number;
  readonly role: string;
  readonly content: string;
  readonly debrief_id: number | null;
  readonly created_at: string;
}

function toMessage(row: MessageRow, role: ThreadMessage["role"]): ThreadMessage {
  return {
    id: row.id,
    role,
    content: row.content,
    debriefId: row.debrief_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * La ligne de l'utilisateur, écrite **sous son JWT** : c'est la RLS qui
 * l'autorise (et qui vérifie au passage le rôle, la longueur et l'absence de
 * référence de debrief), pas la fonction.
 */
export async function insertUserMessage(
  client: CoachUserClient,
  userId: string,
  content: string,
): Promise<ThreadMessage | null> {
  const { data, error } = await client
    .from("coach_thread_messages")
    .insert({ user_id: userId, role: "user", content })
    .select(COLUMNS)
    .single();

  if (error !== null || data === null) {
    console.error("[coach-thread] écriture du message utilisateur en échec", error);
    return null;
  }
  return toMessage(data, "user");
}

/**
 * La ligne du coach, écrite **sous la service key** — le seul chemin qui reste
 * depuis la migration 0015.
 *
 * `debriefId` non nul fait de ce message une carte. L'appartenance du debrief
 * doit avoir été vérifiée par l'appelant (voir `postDebriefCard`) : ici, la RLS
 * ne le fera pas.
 */
export async function insertCoachMessage(
  service: ServiceClient,
  userId: string,
  content: string,
  debriefId: number | null = null,
): Promise<ThreadMessage | null> {
  const { data, error } = await service
    .from("coach_thread_messages")
    .insert({ user_id: userId, role: "coach", content, debrief_id: debriefId })
    .select(COLUMNS)
    .single();

  if (error !== null || data === null) {
    console.error("[coach-thread] écriture du message du coach en échec", error);
    return null;
  }
  return toMessage(data, "coach");
}

/**
 * Retire une ligne du fil — la compensation d'une paire à moitié écrite.
 *
 * Les deux lignes d'un tour ne peuvent plus être insérées ensemble (elles ne
 * passent plus par le même client), donc l'atomicité qu'offrait l'insert
 * groupé est perdue. On la remplace par le patron déjà employé pour une passe
 * de bench orpheline : si la seconde ligne échoue, la première est retirée. Un
 * fil ne doit jamais garder une question sans réponse — il se relirait comme un
 * tour que le coach a ignoré, et repartirait au modèle dans cet état.
 *
 * Un échec de la compensation elle-même n'est pas relancé : l'erreur d'origine
 * est celle qui doit remonter à l'utilisateur.
 */
export async function removeMessage(service: ServiceClient, id: number): Promise<void> {
  const { error } = await service.from("coach_thread_messages").delete().eq("id", id);

  if (error !== null) console.error("[coach-thread] compensation en échec", { id, error });
}

/**
 * Pose une carte debrief dans le fil : la demande, puis la carte.
 *
 * Rend `null` — sans lever — quand la pose échoue. C'est délibéré : le debrief,
 * lui, est déjà généré, enregistré et facturé. Perdre la carte est un défaut
 * d'affichage que l'écran sait rattraper (il ouvre l'historique) ; perdre le
 * debrief serait perdre ce que l'utilisateur a payé.
 */
export async function postDebriefCard(
  client: CoachUserClient,
  service: ServiceClient,
  userId: string,
  debrief: StoredDebrief,
  kind: CardRequestKind,
): Promise<readonly ThreadMessage[] | null> {
  // La vérification que la policy de la 0014 faisait et que la service key
  // court-circuite : le debrief référencé est-il visible par l'appelant ? La
  // lecture passe par **son** client, donc la RLS répond à sa place.
  const { data: owned, error: ownedError } = await client
    .from("debriefs")
    .select("id")
    .eq("id", debrief.id)
    .maybeSingle();

  if (ownedError !== null || owned === null) {
    console.error("[coach-thread] carte refusée : debrief invisible pour l'appelant", {
      debriefId: debrief.id,
    });
    return null;
  }

  const question = await insertUserMessage(client, userId, CARD_REQUEST_LABELS[kind]);

  if (question === null) return null;

  const card = await insertCoachMessage(service, userId, debrief.resume, debrief.id);

  if (card === null) {
    await removeMessage(service, question.id);
    return null;
  }
  return [question, card];
}
