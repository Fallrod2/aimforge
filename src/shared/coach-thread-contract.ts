/**
 * Contrat du **fil du coach** (SPEC §5 sexies, V3) : la forme des échanges
 * entre le navigateur et `POST /api/coach-thread`, et celle des messages relus
 * dans `public.coach_thread_messages` (migration 0014).
 *
 * Un module séparé de `coach-chat-contract.ts`, mais qui lui **emprunte** ce
 * qui ne doit pas diverger : les deux voix (`chatRoleSchema`, miroir du même
 * `check` SQL) et le quota (`CHAT_DAILY_QUOTA`, le compteur `chat` de la
 * migration 0011, que le fil consomme désormais à la place du chat par
 * debrief). Recopier ces valeurs ferait deux vérités pour une seule colonne et
 * un seul compteur.
 *
 * Ce que ce module ajoute, et qui n'existe que dans le fil :
 *
 * 1. **la carte debrief** — un message de coach peut porter la référence d'un
 *    debrief (`debriefId`), et l'écran le rend alors comme une carte plutôt que
 *    comme du texte ;
 * 2. **la suggestion de debrief** — le modèle peut proposer d'en générer un.
 *    Il le signale par un marqueur convenu (`DEBRIEF_SUGGESTION_MARKER`), la
 *    fonction le retire du texte et rend la suggestion à part. Elle ne génère
 *    **rien** : le debrief coûte un quota différent, et une dépense doit rester
 *    un geste de l'utilisateur.
 *
 * Module pur : Zod et rien d'autre. Ni React, ni Supabase, ni SDK.
 */

import { z } from "zod";
import { CHAT_ANSWER_MAX, chatRoleSchema } from "./coach-chat-contract.js";

/**
 * Longueur maximale d'un message envoyé au coach dans le fil.
 *
 * Même borne que le chat par debrief : une question de coaching tient très
 * largement dedans, et au-delà c'est un copier-coller de page entière (ou une
 * tentative de noyer le prompt système) que la fonction refuse avant de
 * dépenser un jeton.
 */
export const THREAD_MESSAGE_MAX = 2000;

/**
 * Messages du fil donnés au modèle comme contexte (SPEC §5 sexies).
 *
 * Plus large que le chat par debrief (20) parce que le fil est **la**
 * conversation : elle n'a pas de sujet extérieur qui la recentre, c'est son
 * propre historique qui la tient. Assez peu, tout de même, pour que le prompt
 * reste borné — le profil, le bench, les matchs et les derniers debriefs
 * portent le reste du contexte.
 */
export const THREAD_HISTORY_SIZE = 30;

/**
 * Matchs importés résumés dans le contexte du fil.
 *
 * Cinq : de quoi parler de la forme récente (« tu enchaînes les défaites sur
 * Icebox ») sans transformer le prompt en export de base de données. Au-delà,
 * le modèle cite des parties que le joueur ne se rappelle plus.
 */
export const THREAD_MATCHES_SIZE = 5;

/** Debriefs récents résumés dans le contexte du fil (SPEC §5 sexies : les 3 derniers). */
export const THREAD_DEBRIEFS_SIZE = 3;

/**
 * Le marqueur par lequel le modèle propose de générer un debrief structuré.
 *
 * **Le contrat, en une phrase** : s'il pense qu'un debrief complet aiderait, le
 * modèle termine sa réponse par cette ligne, seule sur sa ligne. La fonction la
 * retire du texte enregistré et rend `suggestion` à part ; le client affiche un
 * bouton. Rien n'est généré à ce moment-là.
 *
 * Pourquoi un marqueur et pas un contrat JSON : le fil est du texte libre, et
 * lui imposer une enveloppe pour un signal binaire coûterait une relance à
 * chaque fois que le modèle oublie une accolade. Pourquoi cette forme : les
 * doubles crochets et les majuscules n'apparaissent pas dans une phrase
 * française, donc un marqueur trouvé est un marqueur voulu — et s'il ne l'était
 * pas, le pire cas est un bouton proposé à tort, jamais une dépense.
 */
export const DEBRIEF_SUGGESTION_MARKER = "[[DEBRIEF]]";

/**
 * Les deux voix du fil, empruntées au chat : même `check` SQL (`user` /
 * `coach`), même vocabulaire de produit. L'alias existe pour que les modules du
 * fil n'aient qu'un seul contrat à importer, sans que cela crée une seconde
 * définition qui pourrait dériver.
 */
export const threadRoleSchema = chatRoleSchema;

/** Ce que le navigateur envoie à `POST /api/coach-thread`. */
export const threadRequestSchema = z.object({
  message: z.string().trim().min(1).max(THREAD_MESSAGE_MAX),
});

export type ThreadRequest = z.infer<typeof threadRequestSchema>;

/**
 * Un message du fil, tel que l'écran l'affiche.
 *
 * `debriefId` non nul = **carte debrief** : le message a été posé par la
 * génération d'un debrief depuis le fil, et l'écran rend la carte en lecture au
 * lieu du texte. Le `content` reste renseigné (le résumé du debrief) — c'est ce
 * que le modèle relit au tour suivant, et ce qui reste affichable si le debrief
 * a été supprimé depuis (la migration 0014 met alors la référence à `null`).
 */
export const threadMessageSchema = z.object({
  id: z.number().int().positive(),
  role: threadRoleSchema,
  content: z.string().min(1),
  debriefId: z.number().int().positive().nullable(),
  /** Horodatage ISO 8601 de l'enregistrement. */
  createdAt: z.string().min(1),
});

export type ThreadMessage = z.infer<typeof threadMessageSchema>;

/**
 * La suggestion de debrief rendue au client.
 *
 * `matchId` est choisi **par le serveur** — le dernier match importé non
 * débriefé — et pas par le modèle : lui laisser désigner un identifiant, c'est
 * l'inviter à en inventer un. `null` quand il n'y en a aucun : l'écran le dit
 * alors au lieu de proposer un bouton qui échouerait.
 */
export const debriefSuggestionSchema = z.object({
  matchId: z.string().min(1).nullable(),
});

export type DebriefSuggestion = z.infer<typeof debriefSuggestionSchema>;

/**
 * La réponse de `POST /api/coach-thread` en cas de succès : les **deux**
 * messages enregistrés, pas seulement celui du coach.
 *
 * Même raison que le chat par debrief : rien n'est persisté quand la génération
 * échoue, donc le navigateur ne peut pas ajouter localement ce qu'il vient
 * d'envoyer — il aurait un message fantôme après chaque panne.
 */
export const threadResponseSchema = z.object({
  question: threadMessageSchema,
  answer: threadMessageSchema,
  /** La proposition de debrief, quand le modèle l'a posée. */
  suggestion: debriefSuggestionSchema.nullable(),
  /**
   * Messages restants aujourd'hui — ou `null` quand il n'y a rien à compter :
   * l'utilisateur a configuré son propre fournisseur (SPEC §5 ter).
   */
  remaining: z.number().int().min(0).nullable(),
});

export type ThreadResponse = z.infer<typeof threadResponseSchema>;

/**
 * La réponse d'erreur. Même règle que partout ailleurs : `remaining` n'est
 * renseigné que là où il veut dire quelque chose (quota atteint, échec
 * remboursé), et il est **omis** plutôt que nul ailleurs.
 */
export const threadErrorSchema = z.object({
  error: z.string().min(1),
  remaining: z.number().int().min(0).optional(),
});

export type ThreadError = z.infer<typeof threadErrorSchema>;

/**
 * Longueur maximale acceptée pour une réponse du coach dans le fil.
 *
 * Empruntée au chat (`CHAT_ANSWER_MAX`) : même garde-fou, même colonne
 * (`char_length <= 8000`), et aucune raison que le fil accepte plus long que ce
 * qu'un aller-retour de coaching justifie.
 */
export const THREAD_ANSWER_MAX = CHAT_ANSWER_MAX;
