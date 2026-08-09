/**
 * Le résumé d'un match importé, mis en texte pour le coach (SPEC §5 ter bis).
 *
 * Module **pur** : il ne connaît ni Supabase, ni le réseau, ni le prompt — il
 * transforme un `MatchSummary` (la forme écrite dans `imported_matches.payload`
 * par `src/server/valorant/summary.ts`) en le texte que la fonction passera au
 * coach à la place d'un collage.
 *
 * Trois raisons de le faire ici plutôt que dans le navigateur :
 *
 * 1. **le navigateur n'est pas une source** — s'il envoyait le texte, il
 *    suffirait de mentir sur le contenu du match pour faire dire n'importe quoi
 *    au coach tout en gardant le badge « débriefé » ;
 * 2. **le texte est archivé** — c'est lui qui part dans `debriefs.input_raw`,
 *    et il doit rester lisible le jour où le résumé changera de forme ;
 * 3. **il est testable** — le formatage est la seule chose qui puisse se
 *    tromper dans ce chemin, et il se vérifie sans base ni modèle.
 *
 * Le parti pris de rédaction : **une ligne par fait, aucune ligne inventée**.
 * Tout est nullable dans un résumé (une API non officielle a le droit de ne pas
 * renseigner un champ) et une ligne « ADR : inconnu » n'apprend rien au modèle,
 * alors que son absence lui dit exactement la même chose sans l'encourager à
 * combler le vide. Le prompt lui interdit déjà d'inventer des chiffres ; on ne
 * lui en met pas sous la main.
 *
 * Ce texte n'est **pas** neutralisé ici : il traverse `sealStats` avec le reste
 * des données au moment où le prompt le range dans son bloc (`./prompt.ts`).
 * Le neutraliser deux fois ne protégerait pas mieux et rendrait illisible un
 * nom de map qui contiendrait par malchance un chevron.
 */

import {
  type MatchSummary,
  matchSummarySchema,
} from "../../client/data/linked-accounts-contract.js";

/** L'en-tête : il dit au modèle **d'où** vient ce qu'il lit. */
const HEADER = "Partie Valorant importée automatiquement (résumé du fournisseur de données).";

const NO_STATS =
  "Aucune statistique exploitable n'a été importée pour cette partie : appuie-toi sur le bench et le profil.";

const RESULT_LABELS: Readonly<Record<NonNullable<MatchSummary["result"]>, string>> = {
  victoire: "Victoire",
  defaite: "Défaite",
  egalite: "Égalité",
};

/** Le score en rounds, quand les deux moitiés sont là. */
function rounds(match: MatchSummary): string | null {
  if (match.roundsWon === null || match.roundsLost === null) return null;
  return `${match.roundsWon}-${match.roundsLost}`;
}

function result(match: MatchSummary): string | null {
  const label = match.result === null ? null : RESULT_LABELS[match.result];
  const score = rounds(match);

  if (label === null) return score === null ? null : `Score ${score}`;
  return score === null ? label : `${label} ${score}`;
}

/** Le KDA, seulement si les trois compteurs sont là — deux tiers ne se lisent pas. */
function kda(match: MatchSummary): string | null {
  if (match.kills === null || match.deaths === null || match.assists === null) return null;
  return `${match.kills}/${match.deaths}/${match.assists}`;
}

/**
 * Le texte d'un match, prêt à passer au coach.
 *
 * Rend toujours un texte non vide : un match sans aucune statistique reste un
 * match qu'on a le droit de débriefer (le bench et le profil suffisent à dire
 * quelque chose), et refuser ici obligerait l'appelant à traiter un cas de plus
 * pour un gain nul.
 */
export function formatMatchStats(match: MatchSummary): string {
  const lines = [
    ["Map", match.map],
    ["Mode", match.mode],
    ["Agent", match.agent],
    ["Résultat", result(match)],
    ["K/D/A", kda(match)],
    ["ADR", match.adr === null ? null : `${match.adr}`],
    ["Tirs à la tête", match.headshotPercent === null ? null : `${match.headshotPercent} %`],
    ["Jouée le", match.playedAt],
  ].flatMap(([label, value]) => (value === null ? [] : [`- ${label} : ${value}`]));

  return [HEADER, "", ...(lines.length === 0 ? [NO_STATS] : lines)].join("\n");
}

/**
 * Le texte d'un `payload` relu en base, ou `null` s'il ne respecte plus le
 * contrat qui l'a écrit.
 *
 * La colonne est un `jsonb` : Postgres n'en garantit que la syntaxe. Une ligne
 * hors contrat (import d'une version antérieure, écriture manuelle) ne doit pas
 * partir au modèle sous forme de fragments — mieux vaut refuser le débrief et
 * le dire que débriefer un match à moitié lu.
 */
export function matchStatsFrom(payload: unknown): string | null {
  const parsed = matchSummarySchema.safeParse(payload);

  return parsed.success ? formatMatchStats(parsed.data) : null;
}
