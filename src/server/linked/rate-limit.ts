/**
 * Le frein quotidien des fonctions d'import. Module **pur** : l'incrément
 * atomique vit en base (`public.increment_import_usage`, migration 0007) ; ici
 * on ne fait que décider ce que vaut le compteur qu'elle renvoie.
 *
 * Même règle que le quota IA (`src/server/coach/quota.ts`) : on **incrémente
 * d'abord, on décide ensuite**. Décider avant laisserait deux requêtes
 * simultanées lire toutes les deux « 19 » et passer toutes les deux. La
 * contrepartie est assumée : une tentative refusée consomme quand même un
 * incrément, donc le compteur du jour peut dépasser la limite. Ça ne rouvre
 * rien (le verdict est `count <= limit`), ça décourage seulement le martèlement.
 *
 * Et une différence assumée avec le quota IA : ici, un compteur **indisponible
 * ferme la porte** (503) au lieu de la laisser ouverte. Le quota IA protège un
 * budget qui appartient au projet ; ce frein-ci protège des tiers qui peuvent
 * nous bannir. Si on ne sait plus compter, on n'appelle pas.
 */

import {
  type ImportUsageKind,
  KOVAAKS_IMPORT_DAILY_LIMIT,
  RIOT_LINK_DAILY_LIMIT,
} from "../../client/data/linked-accounts-contract.js";

/** Un frein : ce qu'il compte, jusqu'où, et ce qu'on dit quand c'est atteint. */
export interface DailyLimit {
  readonly kind: ImportUsageKind;
  readonly limit: number;
  /** Affiché tel quel par l'écran : il dit quand ça repart et quoi faire en attendant. */
  readonly reached: string;
}

export const KOVAAKS_IMPORT_LIMIT: DailyLimit = {
  kind: "kovaaks_import",
  limit: KOVAAKS_IMPORT_DAILY_LIMIT,
  reached: `Limite atteinte : ${KOVAAKS_IMPORT_DAILY_LIMIT} imports KovaaK's par jour. Le compteur repart demain (heure UTC) ; d'ici là, la saisie manuelle des scores reste ouverte.`,
};

export const RIOT_LINK_LIMIT: DailyLimit = {
  kind: "riot_link",
  limit: RIOT_LINK_DAILY_LIMIT,
  reached: `Limite atteinte : ${RIOT_LINK_DAILY_LIMIT} liaisons Riot par jour. Le compteur repart demain (heure UTC) ; les comptes déjà liés continuent de fonctionner.`,
};

/** Le compteur n'a pas répondu : on ne devine pas, on referme. */
const UNAVAILABLE = "Le compteur d'imports est indisponible. Réessaie dans un instant.";

/**
 * L'incrément, vu d'ici : une promesse de valeur brute.
 *
 * Volontairement non typée en sortie — elle vient d'un RPC Postgres, donc de
 * l'extérieur. La validation est faite ici, une fois, plutôt qu'à chaque
 * appelant.
 */
export type IncrementUsage = (kind: ImportUsageKind) => Promise<unknown>;

export type LimitVerdict =
  | { readonly ok: true; readonly remaining: number }
  | { readonly ok: false; readonly status: 429 | 503; readonly message: string };

/** Le compteur renvoyé par la base est-il exploitable ? */
function usageCount(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : null;
}

/**
 * Consomme une unité du frein et rend le verdict.
 *
 * @param increment Ce qui parle à la base. Injecté pour que cette décision
 *   reste testable sans Postgres — et pour qu'un échec de transport soit traité
 *   ici, avec le reste, plutôt que dupliqué dans chaque fonction serverless.
 */
export async function consumeDailyLimit(
  increment: IncrementUsage,
  quota: DailyLimit,
): Promise<LimitVerdict> {
  let raw: unknown;

  try {
    raw = await increment(quota.kind);
  } catch {
    return { ok: false, status: 503, message: UNAVAILABLE };
  }

  const count = usageCount(raw);

  if (count === null) return { ok: false, status: 503, message: UNAVAILABLE };
  if (count > quota.limit) return { ok: false, status: 429, message: quota.reached };

  return { ok: true, remaining: quota.limit - count };
}
