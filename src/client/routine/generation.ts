/**
 * La génération de routine en cours, hors de la vue (V4-C §4.9).
 *
 * Le magasin est **unique et de module** : il n'y a qu'une routine en
 * génération à la fois, quelle que soit la vue montée. C'est ce qui permet
 * d'ouvrir Perfs pendant l'attente et de retrouver la séance à son retour — la
 * mécanique et ses raisons sont dans `../coach/generation-store.ts`.
 *
 * Ne vit ici que ce qui est propre à la routine : la forme de la demande (celle
 * qu'on rejoue à l'identique sur « Réessayer ») et la lecture d'un échec de
 * `RoutineApiError`.
 */

import type { RoutineResponse } from "../../shared/routine-contract";
import { createGenerationStore, type GenerationFailure } from "../coach/generation-store";
import { RoutineApiError, requestRoutine } from "./routine-api";

/** Les réglages d'une demande : exactement ce que « Réessayer » rejoue. */
export interface RoutineRequest {
  readonly minutes: number;
  readonly focus: string | null;
}

/**
 * Un échec, tel que l'écran doit le dire.
 *
 * Le message vient du serveur quand il en a donné un : ils sont déjà rédigés,
 * et ils en savent plus que nous (quota atteint, clé personnelle refusée,
 * génération trop longue). `remaining` n'arrive que là où le compteur a bougé —
 * notamment après un **remboursement**, pour que l'écran cesse d'afficher une
 * routine consommée qui vient d'être rendue.
 */
export function routineFailure(cause: unknown): GenerationFailure {
  if (cause instanceof RoutineApiError) {
    return { message: cause.message, quota: cause.quotaReached, remaining: cause.remaining };
  }
  return {
    message: cause instanceof Error ? cause.message : "La génération a échoué.",
    quota: false,
    remaining: null,
  };
}

export const routineGeneration = createGenerationStore<RoutineRequest, RoutineResponse>({
  run: ({ minutes, focus }) => requestRoutine(minutes, focus),
  failureOf: routineFailure,
});
