/**
 * Contrat du chat coach (SPEC §5 ter bis) : la forme des échanges entre le
 * navigateur et `POST /api/coach-chat`, et celle des messages relus en base.
 *
 * Un module séparé de `coach-contract.ts` parce que les deux contrats n'ont pas
 * la même nature. Le debrief est une **sortie sous contrat** : le modèle doit
 * rendre un objet JSON, et le schéma sert d'abord à valider ce qu'il produit.
 * Le chat est du **texte libre** : rien à valider côté modèle, tout à valider
 * côté frontières (longueur du message, forme des lignes relues). Les mélanger
 * ferait croire qu'un jour le chat aussi devra rendre du JSON.
 *
 * Module pur : Zod et rien d'autre. Ni React, ni Supabase, ni SDK.
 */

import { z } from "zod";

/**
 * Longueur maximale d'un message envoyé au coach.
 *
 * Une question de coaching tient très largement dedans ; au-delà, c'est un
 * copier-coller de page entière (ou une tentative de noyer le prompt système),
 * et la fonction refuse avant de dépenser un jeton.
 */
export const CHAT_MESSAGE_MAX = 2000;

/**
 * Messages de chat autorisés par utilisateur et par jour UTC.
 *
 * Distinct du quota de debriefs : un message coûte bien moins cher qu'une
 * génération complète, et une conversation qui s'arrête au troisième aller-retour
 * ne sert à rien. La limite est ici une **constante** et non un réglage de
 * `platform_settings` : l'ajouter à la table impliquerait de toucher le contrat
 * d'administration et son écran, ce qui n'appartient pas à cette fonctionnalité.
 * Elle deviendra un réglage le jour où quelqu'un aura besoin de la changer sans
 * redéploiement.
 */
export const CHAT_DAILY_QUOTA = 20;

/**
 * Messages de la conversation donnés au modèle comme contexte.
 *
 * Assez pour que le fil se tienne, assez peu pour que le prompt reste borné :
 * au-delà, c'est le debrief et le bench qui portent le contexte utile, pas les
 * quinze premiers allers-retours.
 */
export const CHAT_HISTORY_SIZE = 20;

/**
 * Longueur maximale acceptée pour une réponse du coach.
 *
 * Ce n'est pas une consigne de rédaction (le prompt s'en charge) mais un
 * garde-fou : le budget de jetons borne déjà la sortie autour de 3 000
 * caractères, donc seule une réponse manifestement hors format passe par ici.
 * Reste sous la borne de la colonne (`char_length <= 8000`, migration 0011)
 * pour qu'un texte accepté ici soit toujours enregistrable.
 */
export const CHAT_ANSWER_MAX = 4000;

/**
 * Les deux voix d'une conversation, miroir du `check` de `coach_messages`.
 *
 * « coach » et non « assistant » : c'est le vocabulaire du produit, et la table
 * n'a pas à ressembler à l'API d'un fournisseur. La traduction vers les rôles du
 * modèle se fait dans le prompt, à un seul endroit.
 */
export const CHAT_ROLES = ["user", "coach"] as const;

export const chatRoleSchema = z.enum(CHAT_ROLES);

export type ChatRole = (typeof CHAT_ROLES)[number];

/**
 * Ce que le navigateur envoie à `POST /api/coach-chat`.
 *
 * `debrief_id` en serpent parce que c'est la clé telle que la base la nomme et
 * telle que la fonction la relit ; le reste du contrat, qui n'existe que côté
 * client, garde le camel du projet.
 */
export const chatRequestSchema = z.object({
  debrief_id: z.number().int().positive(),
  message: z.string().trim().min(1).max(CHAT_MESSAGE_MAX),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** Un message enregistré, tel que l'écran l'affiche. */
export const chatMessageSchema = z.object({
  id: z.number().int().positive(),
  debriefId: z.number().int().positive(),
  role: chatRoleSchema,
  content: z.string().min(1),
  /** Horodatage ISO 8601 de l'enregistrement. */
  createdAt: z.string().min(1),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

/**
 * La réponse de `POST /api/coach-chat` en cas de succès : les **deux** messages
 * enregistrés, pas seulement la réponse.
 *
 * Le message de l'utilisateur revient parce qu'il n'existe qu'une fois la
 * génération réussie (rien n'est persisté sur un échec, SPEC §5 ter bis) : le
 * navigateur ne peut donc pas se contenter d'ajouter localement ce qu'il vient
 * d'envoyer, il aurait un message fantôme après chaque panne.
 */
export const chatResponseSchema = z.object({
  question: chatMessageSchema,
  answer: chatMessageSchema,
  /**
   * Messages restants aujourd'hui — ou `null` quand il n'y a rien à compter :
   * l'utilisateur a configuré son propre fournisseur (SPEC §5 ter).
   */
  remaining: z.number().int().min(0).nullable(),
});

export type ChatResponse = z.infer<typeof chatResponseSchema>;

/**
 * La réponse d'erreur. Même règle que pour le coach : `remaining` n'est
 * renseigné que là où il veut dire quelque chose (quota atteint, échec
 * remboursé), et il est **omis** plutôt que nul ailleurs — facultatif ne veut
 * pas dire nullable.
 */
export const chatErrorSchema = z.object({
  error: z.string().min(1),
  remaining: z.number().int().min(0).optional(),
});

export type ChatError = z.infer<typeof chatErrorSchema>;
