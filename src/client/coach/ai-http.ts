/**
 * Ce que les trois appels IA de l'espace Coach ont en commun (V4-C §4.9).
 *
 * `routine-api`, `coach-api` et `thread-api` gardent chacun leur classe
 * d'erreur, leur contrat et leurs phrases — ce sont trois fonctions
 * différentes. Ce qui n'a aucune raison d'exister en trois exemplaires, c'est
 * la **classification** de deux échecs que le navigateur est seul à voir :
 *
 * 1. **l'abandon sur délai.** Sans `signal`, un `fetch` attend ce que la pile
 *    réseau veut bien : plusieurs minutes sur un socket muet, avec un écran
 *    bloqué sur « Génération… ». Le délai posé ici est volontairement **plus
 *    long que le `maxDuration` du serveur** (cf. `src/shared/ai-timing.ts`) —
 *    il n'arbitre pas la génération, il donne une fin à l'attente quand la
 *    plateforme elle-même n'en a pas donné ;
 * 2. **la réponse opaque de la plateforme.** Nos fonctions répondent toujours
 *    en JSON, y compris pour dire qu'elles échouent. Un 502/504 **sans** corps
 *    JSON ne vient donc pas d'elles : c'est la plateforme qui a coupé. Le dire
 *    ainsi vaut mieux que « réponse inattendue », qui laisse croire à un bug de
 *    contrat.
 */

import { AI_CLIENT_TIMEOUT_MS } from "../../shared/ai-timing";

/** Le délai à joindre à un `fetch` vers une fonction IA. */
export function aiRequestSignal(): AbortSignal {
  return AbortSignal.timeout(AI_CLIENT_TIMEOUT_MS);
}

const TIMED_OUT =
  "La génération n'a pas répondu à temps. Elle a peut-être abouti côté serveur : recharge la page avant de relancer.";

const INTERRUPTED =
  "La génération a été interrompue par la plateforme avant de répondre. Réessaie dans un instant.";

/** L'abandon sur délai se reconnaît à son nom, pas à son message. */
function timedOut(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "TimeoutError";
}

/**
 * Le message d'un `fetch` qui n'a jamais abouti.
 *
 * @param offline La phrase propre à la fonction appelée, pour tout le reste
 *   (coupure réseau, DNS, page fermée).
 */
export function transportMessage(cause: unknown, offline: string): string {
  return timedOut(cause) ? TIMED_OUT : offline;
}

/**
 * Le message d'un échec HTTP dont le corps n'est pas un JSON du contrat.
 *
 * @param notDeployed La phrase du 404 de développement, propre à la fonction.
 * @param unexpected Le repli, quand le statut ne dit rien de particulier.
 */
export function opaqueMessage(status: number, notDeployed: string, unexpected: string): string {
  if (status === 404) return notDeployed;
  if (status === 502 || status === 504) return INTERRUPTED;
  return unexpected;
}
