/**
 * Décision du **pull automatique** des scores KovaaK's (SPEC §5 sexies, V6).
 * Module pur (aucun React) : la règle « une fois par palier et par session
 * d'onglet » se teste sans DOM ni réseau.
 *
 * Le bouton « Importer mes scores » a disparu : dès qu'un compte KovaaK's est
 * lié, ouvrir le tracker déclenche l'import du palier affiché. C'est le geste
 * que l'utilisateur faisait de toute façon — mais il coûte un appel à une
 * source non officielle, freinée à 20 imports par jour côté serveur
 * (`src/server/linked/rate-limit.ts`). D'où trois verrous, du plus large au
 * plus fin :
 *
 * 1. **la mémoire d'onglet** (`sessionAutoPulls`), et pas un état de
 *    composant : le tracker se démonte à chaque passage par le tableau de bord,
 *    et un état local ferait repartir un import à chaque retour — cinq
 *    allers-retours dans le menu suffiraient à manger le quart du quota du
 *    jour. Elle survit aussi au double montage de `StrictMode` en développement,
 *    parce qu'elle est écrite au moment de la décision, pas au prochain rendu ;
 * 2. **l'état d'import du palier** (`ImportState`) : on ne relance jamais
 *    par-dessus un import en vol, ni par-dessus un import abouti ou en échec —
 *    ce que l'utilisateur a devant les yeux ne doit pas être réécrit sous lui ;
 * 3. **le palier de départ** (`ready`) : tant qu'on ne sait pas quel palier
 *    afficher (il vient du dernier bench, cf. `start-tier.ts`), attendre. Sans
 *    ce verrou, on importerait Novice puis, une seconde plus tard, le vrai
 *    palier — deux appels pour un besoin.
 *
 * Le rate-limit serveur reste le garde-fou dur : ceci n'est qu'une politesse.
 */

import type { TierId } from "../../lib/energy";
import type { ImportState } from "./import";

/** Les paliers déjà pré-remplis tout seuls. Une marque, sans autre donnée. */
export type AutoPulls = Readonly<Partial<Record<TierId, true>>>;

export const NO_AUTO_PULLS: AutoPulls = {};

export function withAutoPull(pulls: AutoPulls, tier: TierId): AutoPulls {
  return { ...pulls, [tier]: true };
}

export function hasAutoPulled(pulls: AutoPulls, tier: TierId): boolean {
  return pulls[tier] === true;
}

/** Ce que l'écran sait au moment de décider. */
export interface AutoPullContext {
  /** Le palier affiché. */
  readonly tier: TierId;
  /** Un compte KovaaK's est lié (et la liste des comptes est chargée). */
  readonly hasAccount: boolean;
  /** Le palier de départ est arrêté : l'afficher ne le fera plus changer. */
  readonly ready: boolean;
  readonly pulls: AutoPulls;
  readonly state: ImportState;
}

/**
 * Faut-il lancer l'import tout seul ?
 *
 * `true` **au plus une fois par palier et par session d'onglet** — l'appelant
 * doit marquer le palier (`withAutoPull`) avant de lancer la requête, pas
 * après : entre les deux, React peut rendre à nouveau.
 */
export function shouldAutoPull(context: AutoPullContext): boolean {
  const { tier, hasAccount, ready, pulls, state } = context;

  if (!hasAccount || !ready) return false;
  if (hasAutoPulled(pulls, tier)) return false;
  return state.status === "idle";
}

/**
 * Des chiffres sont-ils en route pour ce palier ?
 *
 * C'est ce qui commande le squelette de saisie : l'écran ne montre les 9
 * sous-catégories en attente que s'il a une raison de croire qu'elles vont se
 * remplir toutes seules. Deux cas, et deux seulement — un import en vol, ou un
 * palier que le pull automatique n'a pas encore visité.
 *
 * Ce que ça exclut est aussi important : après un import abouti ou en échec, et
 * après un « Effacer la saisie » (qui remet le palier au repos alors que le
 * pull a déjà eu lieu), plus rien n'arrivera tout seul. Montrer un squelette à
 * ce moment-là ferait attendre quelqu'un qui n'a qu'à taper.
 */
export function awaitsAutoPull(state: ImportState, pulls: AutoPulls, tier: TierId): boolean {
  if (state.status === "loading") return true;
  return state.status === "idle" && !hasAutoPulled(pulls, tier);
}

/* ------------------------------------------------------------------ */
/* Mémoire d'onglet                                                    */
/* ------------------------------------------------------------------ */

let sessionPulls: AutoPulls = NO_AUTO_PULLS;

/** Les paliers déjà pré-remplis automatiquement depuis l'ouverture de l'onglet. */
export function sessionAutoPulls(): AutoPulls {
  return sessionPulls;
}

/** Marque un palier comme pré-rempli, pour toute la durée de l'onglet. */
export function rememberAutoPull(tier: TierId): void {
  sessionPulls = withAutoPull(sessionPulls, tier);
}

/** Repart d'une session vierge. Réservé aux tests. */
export function forgetAutoPulls(): void {
  sessionPulls = NO_AUTO_PULLS;
}
