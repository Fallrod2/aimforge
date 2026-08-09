/**
 * Lecture de la conversation d'un debrief (`public.coach_messages`, SPEC
 * §5 ter bis).
 *
 * L'**écriture** n'est pas ici : c'est la fonction serverless `api/coach-chat`
 * qui insère les deux messages d'un aller-retour, juste après avoir obtenu la
 * réponse du modèle — mais avec le JWT de l'utilisateur, donc sous la même RLS
 * que ce module. Le navigateur ne peut pas écrire lui-même sans faire confiance
 * à ce qu'il a reçu, et surtout sans compter le quota.
 *
 * La lecture, elle, passe en direct par Supabase : c'est une simple liste, elle
 * n'a besoin d'aucun secret, et la faire transiter par une fonction serverless
 * n'ajouterait qu'un aller-retour.
 */

import { type ChatMessage, chatRoleSchema } from "../../shared/coach-chat-contract";
import { supabase } from "../supabase/client";
import { queryError } from "./errors";

/**
 * Messages relus par conversation.
 *
 * Plus large que ce que le modèle reçoit en contexte : l'écran affiche le fil
 * entier, c'est le prompt qui se limite aux derniers tours.
 */
const HISTORY_LIMIT = 200;

/**
 * La conversation d'un debrief, du plus ancien au plus récent.
 *
 * Le tri est sur `id` et non sur `created_at` : deux messages insérés dans la
 * même instruction (la question et la réponse le sont) partagent la
 * milliseconde, et seul l'identifiant, monotone, dit lequel a été dit en
 * premier.
 *
 * Une ligne dont le rôle n'est pas l'un des deux attendus est **écartée** : la
 * contrainte de la migration 0011 la rend impossible, et l'afficher sans savoir
 * qui parle serait pire que de ne pas l'afficher.
 */
export async function listCoachMessages(debriefId: number): Promise<readonly ChatMessage[]> {
  const { data, error } = await supabase
    .from("coach_messages")
    .select("id, debrief_id, role, content, created_at")
    .eq("debrief_id", debriefId)
    .order("id", { ascending: true })
    .limit(HISTORY_LIMIT);

  if (error !== null || data === null) {
    throw queryError(error, "La conversation n'a pas pu être chargée.");
  }

  const messages: ChatMessage[] = [];

  for (const row of data) {
    const role = chatRoleSchema.safeParse(row.role);

    if (!role.success) continue;

    const time = Date.parse(row.created_at);

    messages.push({
      id: row.id,
      debriefId: row.debrief_id,
      role: role.data,
      content: row.content,
      createdAt: Number.isNaN(time) ? row.created_at : new Date(time).toISOString(),
    });
  }
  return messages;
}
