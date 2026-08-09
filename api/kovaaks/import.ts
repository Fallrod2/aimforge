/**
 * `POST /api/kovaaks/import` — les scores Voltaic d'un pseudo KovaaK's
 * (SPEC §5 bis, §7-P3b).
 *
 * Cette fonction **n'écrit rien**. Elle lit le Benchmark Tracker, traduit les
 * scores en noms de scénarios Voltaic, et rend le tout au navigateur qui
 * pré-remplit la grille de saisie. C'est l'utilisateur qui vérifie et
 * sauvegarde — un import qui écrirait une passe directement en base ferait de
 * la donnée d'une source non officielle une vérité, sans que personne l'ait
 * regardée.
 *
 * Elle n'a donc pas non plus besoin de secret : le Benchmark Tracker est
 * public. Le JWT, lui, reste exigé — la fonction ne s'ouvre pas plus que le
 * reste de l'application, et rien ne justifie de laisser un tiers s'en servir
 * comme d'un proxy anonyme vers kovaaks.com.
 *
 * Tout ce qui mérite d'être testé (correspondance des noms, échelle des
 * scores, inventaire des manquants) vit dans `src/server/kovaaks/benchmark.ts`,
 * en module pur. Ici, on enchaîne et on traduit les échecs en codes HTTP.
 */

import {
  type KovaaksImportResponse,
  kovaaksImportRequestSchema,
} from "../../src/client/data/linked-accounts-contract.js";
import { mapBenchmarkProgress } from "../../src/server/kovaaks/benchmark.js";
import {
  fetchBenchmarkProgress,
  findPlayer,
  KovaaksError,
  startKovaaksBudget,
} from "../_lib/kovaaks.js";
import { authenticate, fail, json, readBody } from "../_lib/request.js";

/**
 * Deux appels à une source non officielle, avec relance chacun.
 *
 * Le pire cas n'est pas la somme des délais : les deux appels partagent un
 * budget de 14 s (`TOTAL_BUDGET_MS` dans `api/_lib/kovaaks.ts`, où le calcul
 * est détaillé). Les 6 s restantes couvrent la vérification du jeton et la
 * construction de la réponse — c'est cette marge qui garantit que même un
 * KovaaK's muet ressorte d'ici en erreur rédigée plutôt qu'en fonction tuée.
 */
export const maxDuration = 20;

const INVALID_BODY = "Pseudo KovaaK's et palier attendus.";

function unknownPseudo(username: string): string {
  return `Aucun joueur KovaaK's ne s'appelle « ${username} ». Vérifie l'orthographe : c'est le pseudo du site kovaaks.com, pas le nom du compte Steam.`;
}

export async function POST(request: Request): Promise<Response> {
  // 1. Identité, avant tout le reste.
  const auth = await authenticate(request);

  if (!auth.ok) return auth.response;

  // 2. Entrée.
  const body = await readBody(request, kovaaksImportRequestSchema, INVALID_BODY);

  if (!body.ok) return body.response;

  const { username, tier } = body.value;

  // 3. Le pseudo, puis la progression. Les deux appels peuvent échouer de la
  //    même façon (source muette, réponse hors forme) : `KovaaksError` porte
  //    déjà le statut et la phrase à afficher.
  const budget = startKovaaksBudget();

  try {
    const player = await findPlayer(username, budget);

    if (player === null) return fail(unknownPseudo(username), 404);

    const progress = await fetchBenchmarkProgress(player.steamId, tier, budget);
    const mapped = mapBenchmarkProgress(tier, progress);

    if (mapped.unknown.length > 0) {
      // Pas une erreur pour l'utilisateur — mais le signe que le benchmark
      // amont a bougé, et la seule trace qu'on en aura.
      console.warn("[kovaaks] scénarios non rattachés", { tier, unknown: mapped.unknown });
    }

    const response: KovaaksImportResponse = {
      username: player.username,
      steamId: player.steamId,
      tier,
      scores: mapped.scores,
      missing: [...mapped.missing],
      unknown: [...mapped.unknown],
    };

    return json(response, 200);
  } catch (cause) {
    if (cause instanceof KovaaksError) {
      // Un 404 du transport veut dire « ce joueur n'a pas ce benchmark », ce
      // qui n'est pas la même chose qu'un pseudo inconnu.
      if (cause.status === 404) {
        return fail(
          `« ${username} » n'a aucun score sur le benchmark Voltaic S5 ${tier}. Joue-le une fois sur KovaaK's, ou saisis tes scores à la main.`,
          404,
        );
      }
      console.error("[kovaaks] import en échec", cause);
      return fail(cause.message, cause.status);
    }
    console.error("[kovaaks] échec inattendu", cause);
    return fail("L'import KovaaK's a échoué. Réessaie dans un instant.", 500);
  }
}
