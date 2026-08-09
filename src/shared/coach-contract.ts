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

/**
 * Taille maximale du texte collé par le joueur. Au-delà, la fonction répond
 * 413 sans appeler le modèle : un tableau de stats de partie tient très
 * largement dans 8 000 caractères, ce qui dépasse est un copier-coller de page
 * entière (ou une tentative de noyer le prompt système).
 */
export const MAX_STATS_LENGTH = 8000;

/** Debriefs autorisés par utilisateur et par jour UTC (SPEC §4). */
export const COACH_DAILY_QUOTA = 5;

/**
 * Ce que le navigateur envoie à `POST /api/coach`.
 *
 * Le détourage vient **avant** la longueur minimale : sans lui, un corps
 * `{"stats":"   "}` passerait la validation et partirait au modèle — la
 * fonction ne peut pas compter sur le formulaire pour l'en empêcher, elle est
 * appelable directement.
 */
export const coachRequestSchema = z.object({
  stats: z.string().trim().min(1).max(MAX_STATS_LENGTH),
});

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
});

export type StoredDebrief = z.infer<typeof storedDebriefSchema>;

/** La réponse de `POST /api/coach` en cas de succès. */
export const coachResponseSchema = z.object({
  debrief: storedDebriefSchema,
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
});

export type CoachError = z.infer<typeof coachErrorSchema>;
