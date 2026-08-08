/**
 * Contrats Zod de l'API : validation des entrées **et** des sorties.
 * Une sortie qui ne passe pas son schéma est un bug serveur (500), pas un 400.
 */

import { z } from "zod";
import { TIER_IDS } from "../../lib/energy";

export const tierIdSchema = z.enum(TIER_IDS);

/** Date ISO 8601 acceptée en entrée ; normalisée en UTC côté serveur. */
const isoDateSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Date ISO 8601 attendue");

export const createBenchRunSchema = z.object({
  tier: tierIdSchema,
  date: isoDateSchema.optional(),
  /** Scores partiels autorisés, mais au moins un scénario renseigné. */
  scores: z
    .record(z.string().min(1), z.number().min(0))
    .refine((scores) => Object.keys(scores).length > 0, "Au moins un score est requis"),
});

export type CreateBenchRunInput = z.infer<typeof createBenchRunSchema>;

export const listBenchRunsQuerySchema = z.object({
  tier: tierIdSchema.optional(),
});

export const benchRunIdSchema = z.coerce.number().int().positive();

export const benchRunSummarySchema = z.object({
  id: z.number().int().positive(),
  date: z.string(),
  tier: tierIdSchema,
  overall: z.number().min(0),
  rank: z.string().nullable(),
  complete: z.boolean(),
});

export const benchRunSummaryListSchema = z.array(benchRunSummarySchema);

export const scenarioScoreSchema = z.object({
  scenario: z.string(),
  score: z.number().min(0),
  energy: z.number().min(0),
});

export const subcategoryEnergySchema = z.object({
  name: z.string(),
  energy: z.number().min(0),
});

export const benchRunDetailSchema = benchRunSummarySchema.extend({
  scores: z.array(scenarioScoreSchema),
  subcategories: z.array(subcategoryEnergySchema),
});

export const profileSchema = z.object({
  pseudo: z.string().nullable(),
  currentRank: z.string().nullable(),
  peakRank: z.string().nullable(),
  mainAgent: z.string().nullable(),
  goal: z.string().nullable(),
  weakMapsNotes: z.string().nullable(),
});

export type Profile = z.infer<typeof profileSchema>;

/**
 * PUT profil : **fusion**. Un champ absent garde sa valeur, un champ à `null`
 * l'efface. Le singleton est créé au premier PUT.
 */
export const updateProfileSchema = profileSchema.partial();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
