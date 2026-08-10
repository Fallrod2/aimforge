/**
 * Contrat du Coach post-game : la forme des échanges entre le navigateur et la
 * fonction serverless `api/coach`, et la forme du debrief attendu du modèle.
 *
 * Un seul module pour les deux côtés : la fonction valide ce qu'elle reçoit du
 * modèle avec ces schémas, le client valide ce qu'il reçoit de la fonction et
 * ce qu'il relit en base avec les mêmes. Deux copies dériveraient — et la
 * dérive ne se verrait qu'en production, sur un debrief à moitié affiché.
 *
 * Module pur : Zod et rien d'autre. Ni React, ni Supabase, ni SDK Anthropic.
 */

import { z } from "zod";
import { threadMessageSchema } from "./coach-thread-contract.js";

/**
 * Taille maximale du texte collé par le joueur. Au-delà, la fonction répond
 * 413 sans appeler le modèle : un tableau de stats de partie tient très
 * largement dans 8 000 caractères, ce qui dépasse est un copier-coller de page
 * entière (ou une tentative de noyer le prompt système).
 */
export const MAX_STATS_LENGTH = 8000;

/**
 * Longueur maximale d'une référence de match. Les identifiants Riot sont des
 * UUID (36 caractères) ; la marge couvre un fournisseur qui nommerait ses
 * matchs autrement, sans laisser passer un texte déguisé en identifiant.
 */
export const MAX_MATCH_ID_LENGTH = 120;

/** Debriefs autorisés par utilisateur et par jour UTC (SPEC §4). */
export const COACH_DAILY_QUOTA = 5;

/**
 * Ce que le navigateur envoie à `POST /api/coach` — **une entrée ou l'autre**
 * (SPEC §5 ter bis).
 *
 * - `stats` : le texte collé par le joueur, chemin d'origine, seul disponible
 *   pour une partie non importée ;
 * - `match_id` : la référence d'un match déjà importé. Le serveur va lire le
 *   résumé dans `imported_matches` **sous la RLS de l'appelant** et le formate
 *   lui-même. Le navigateur n'envoie donc pas de stats qu'il aurait
 *   pré-formatées : sinon il suffirait de mentir sur le contenu du match pour
 *   faire dire n'importe quoi au coach tout en gardant le badge « débriefé ».
 *
 * Le détourage vient **avant** la longueur minimale : sans lui, un corps
 * `{"stats":"   "}` passerait la validation et partirait au modèle — la
 * fonction ne peut pas compter sur le formulaire pour l'en empêcher, elle est
 * appelable directement.
 *
 * Une union et non deux champs facultatifs : « ni l'un ni l'autre » et « les
 * deux à la fois » sont des corps que le serveur n'a pas à interpréter, et le
 * schéma est le bon endroit pour le dire. Un corps qui porte les deux entre
 * par la première branche (`stats`), qui reste le chemin de référence.
 */
/**
 * Le drapeau du fil (SPEC §5 sexies), commun aux deux branches.
 *
 * `true` = ce debrief est demandé **depuis le fil du coach** (ou depuis un
 * geste qui y mène, comme « Débriefer » sur un match du dashboard) : la
 * fonction y pose alors la carte, sous la service key, parce que la migration
 * 0015 interdit au navigateur d'écrire une ligne `role = 'coach'`.
 *
 * Absent ou `false` = le debrief reste dans l'historique et nulle part
 * ailleurs. C'est le cas du collage manuel : un debrief collé depuis
 * l'historique n'est pas un tour de conversation.
 *
 * Facultatif plutôt qu'obligatoire : un appelant qui l'ignore obtient le
 * comportement d'avant le fil, ce qui est le bon défaut pour un drapeau
 * d'affichage.
 */
const threadFlag = { thread: z.boolean().optional() };

export const coachRequestSchema = z.union([
  z.object({ stats: z.string().trim().min(1).max(MAX_STATS_LENGTH), ...threadFlag }),
  z.object({ match_id: z.string().trim().min(1).max(MAX_MATCH_ID_LENGTH), ...threadFlag }),
]);

export type CoachRequest = z.infer<typeof coachRequestSchema>;

/** Un axe de travail : un titre court, un détail actionnable. */
export const coachAxeSchema = z.object({
  titre: z.string().min(1).max(120),
  detail: z.string().min(1).max(800),
});

export type CoachAxe = z.infer<typeof coachAxeSchema>;

/**
 * Le debrief tel que le modèle doit le rendre.
 *
 * Les bornes hautes sont larges à dessein : elles sont là pour attraper une
 * sortie manifestement hors format (un roman, une liste de vingt axes), pas
 * pour discipliner la rédaction — un debrief refusé coûte une relance, donc de
 * la latence, pour un défaut que l'utilisateur n'aurait jamais remarqué.
 */
export const coachDebriefSchema = z.object({
  resume: z.string().min(1).max(2000),
  points_forts: z.array(z.string().min(1).max(400)).min(1).max(8),
  axes: z.array(coachAxeSchema).min(1).max(6),
  focus: z.string().min(1).max(400),
});

export type CoachDebrief = z.infer<typeof coachDebriefSchema>;

/** Un debrief enregistré : le contenu, plus ce que la base y a ajouté. */
export const storedDebriefSchema = coachDebriefSchema.extend({
  id: z.number().int().positive(),
  /** Horodatage ISO 8601 de l'enregistrement. */
  date: z.string().min(1),
  /**
   * Le match importé débriefé, quand le debrief en vient (SPEC §5 ter bis) —
   * `null` pour un collage manuel, ce que sont tous les debriefs antérieurs à
   * la migration 0011.
   *
   * Valeur par défaut plutôt que champ obligatoire : le schéma relit aussi des
   * lignes écrites avant que la colonne existe, et un debrief sans référence de
   * match n'est pas un debrief cassé.
   */
  match_id: z.string().min(1).nullable().default(null),
});

export type StoredDebrief = z.infer<typeof storedDebriefSchema>;

/** La réponse de `POST /api/coach` en cas de succès. */
export const coachResponseSchema = z.object({
  debrief: storedDebriefSchema,
  /**
   * Les deux messages posés dans le fil quand la requête portait
   * `thread: true` : la demande, puis la carte (SPEC §5 sexies).
   *
   * Ils reviennent pour que l'écran les affiche **sans recharger** — le
   * navigateur ne peut plus les écrire lui-même (migration 0015), donc il ne
   * peut pas non plus les deviner.
   *
   * **Facultatif, et l'absence n'est pas un échec** : le debrief est généré,
   * enregistré et facturé avant que la carte soit posée. Si la pose échoue, la
   * réponse rend le debrief sans `thread` plutôt que de perdre ce qui a été
   * payé ; l'écran se rabat alors sur l'historique.
   */
  thread: z.array(threadMessageSchema).optional(),
  /**
   * Debriefs restants aujourd'hui, après celui-ci — ou `null` quand il n'y a
   * rien à compter : l'utilisateur a configuré son propre fournisseur (SPEC
   * §5 ter), donc le quota AimForge ne le concerne plus. `null` est un état,
   * pas une absence de mesure : l'écran l'affiche comme « quota levé ».
   */
  remaining: z.number().int().min(0).nullable(),
});

export type CoachResponse = z.infer<typeof coachResponseSchema>;

/**
 * La réponse d'erreur de `POST /api/coach`.
 *
 * `remaining` n'est renseigné que là où il veut dire quelque chose : le quota
 * atteint (429), et les échecs qui ont **remboursé** l'incrément (migration
 * 0010) — le compteur y a bougé, l'écran doit le savoir. Ailleurs, l'appel n'a
 * pas atteint le compteur, et la clé est absente plutôt que nulle : facultative
 * ne veut pas dire nullable, un `null` ferait échouer cette relecture.
 */
export const coachErrorSchema = z.object({
  error: z.string().min(1),
  remaining: z.number().int().min(0).optional(),
  /**
   * Le debrief qui existe déjà pour ce match (409). Il n'est pas là pour
   * expliquer l'échec mais pour le rendre utile : l'écran peut proposer
   * « voir le debrief » au lieu de laisser l'utilisateur chercher lequel.
   */
  debrief_id: z.number().int().positive().optional(),
});

export type CoachError = z.infer<typeof coachErrorSchema>;
