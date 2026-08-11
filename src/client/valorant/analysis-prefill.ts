/**
 * L'amorce déposée dans le fil du coach quand on clique sur « Approfondir avec
 * le coach » depuis la page d'un match (SPEC §5 sexies, V4). Module **pur** : il
 * ne connaît ni React, ni la boîte à lettres (`../coach/prefill`), ni le
 * routeur — il rend une phrase.
 *
 * Pourquoi une phrase, et pas l'analyse elle-même : le fil du coach traite le
 * texte pré-rempli comme un **message du joueur**. Y recopier l'analyse
 * reviendrait à faire dire au joueur ce que le coach vient d'écrire, puis à
 * renvoyer ce texte au modèle comme s'il en était l'auteur. Le coach n'a pas
 * besoin de cette recopie : son contexte porte déjà les derniers matchs
 * importés (`api/_lib/coach-thread-context.ts`), donc trois repères suffisent à
 * lui désigner la bonne partie — la map, la date, le résultat.
 *
 * L'amorce est modifiable : elle atterrit dans le champ de saisie, pas dans un
 * envoi. Le joueur peut la réécrire, la compléter, ou l'effacer — c'est un point
 * de départ, pas une question qu'on pose à sa place.
 *
 * Aucune borne de longueur ici : trois repères tiennent très largement sous les
 * 2 000 caractères du contrat, et l'écran du coach signale de toute façon un
 * texte trop long au lieu de le tronquer en silence.
 */

import type { MatchDetail } from "../data";
import { formatRunDate } from "../format";
import { RESULT_LABELS } from "./display";

/**
 * Le score en rounds, seulement quand les deux moitiés sont là.
 *
 * Un demi-score ne se lit pas, et « 11 » tout seul dans une phrase que le modèle
 * relira ferait un chiffre de plus à interpréter.
 */
function score(detail: MatchDetail): string | null {
  if (detail.roundsWon === null || detail.roundsLost === null) return null;
  return `${detail.roundsWon}-${detail.roundsLost}`;
}

/**
 * Le verdict et le score réunis, ou `null` si la source n'a donné ni l'un ni
 * l'autre.
 *
 * `RESULT_LABELS` plutôt que `resultLabel` : ce dernier rend « Résultat
 * inconnu », ce qui est juste à l'écran (une case du tableau doit être remplie)
 * et faux dans une phrase — on préfère ne pas parler du résultat que d'annoncer
 * son ignorance au coach.
 */
function outcome(detail: MatchDetail): string | null {
  const label = detail.result === null ? null : RESULT_LABELS[detail.result];
  const rounds = score(detail);

  if (label === null) return rounds === null ? null : rounds;
  return rounds === null ? label : `${label} ${rounds}`;
}

/** Ce qu'on écrit quand la source n'a donné aucun des trois repères. */
const NAMELESS = "la partie que je viens d'ouvrir";

/**
 * Les repères de la partie, sous la forme « sur Ascent, le 9 août 2026, 20:12
 * (Défaite 11-13) ».
 *
 * Chaque morceau disparaît quand la source ne l'a pas donné, et la phrase reste
 * grammaticale dans les huit combinaisons possibles.
 */
export function matchLabel(detail: MatchDetail): string {
  const place = detail.map === null ? null : `sur ${detail.map}`;
  const when = detail.playedAt === null ? null : `le ${formatRunDate(detail.playedAt)}`;
  const verdict = outcome(detail);
  const situated = [place, when].flatMap((part) => (part === null ? [] : [part])).join(", ");

  if (situated === "")
    return verdict === null ? NAMELESS : `la partie que je viens d'ouvrir (${verdict})`;
  return verdict === null ? `ma partie ${situated}` : `ma partie ${situated} (${verdict})`;
}

/**
 * L'amorce complète, prête à être déposée avec `setCoachPrefill`.
 *
 * Elle nomme la partie puis pose **une** demande ouverte : approfondir. Deux
 * questions enchaînées feraient un premier tour brouillon, et le joueur a le
 * champ sous les yeux pour préciser ce qu'il veut vraiment savoir.
 */
export function coachPrefillForMatch(detail: MatchDetail): string {
  return `Revenons sur ${matchLabel(detail)}. Peux-tu approfondir l'analyse de cette partie et me dire quoi travailler en priorité ?`;
}
