/**
 * La liste des parties de la fenêtre (SPEC §5 sexies, V2).
 *
 * Elle est aussi **la lecture chiffrée des graphes de tendance** juste
 * au-dessus : chaque partie y porte son HS% et son ADR, dans l'ordre inverse
 * (la plus récente en tête, celle qu'on cherche d'abord). Une valeur qu'on ne
 * pourrait lire qu'en survolant un point serait une valeur inaccessible au
 * clavier — les figures survolent, elles ne gardent rien pour elles.
 *
 * Chaque ligne est un lien vers `#/valorant?match=<id>` : une adresse, donc un
 * clic du milieu, un « ouvrir dans un nouvel onglet » et un partage de lien
 * marchent comme partout ailleurs.
 */

import type { TrendPoint } from "../data";
import { formatRunDate } from "../format";
import { routeHash } from "../route";
import { formatAdr, formatPercent, resultLabel, UNKNOWN } from "./display";
import { Empty, Section } from "./ui";

interface MatchListProps {
  /** Les parties de la fenêtre, du plus ancien au plus récent (ordre serveur). */
  readonly trend: readonly TrendPoint[];
  /** Match → debrief existant, pour le badge. Vide si la lecture a échoué. */
  readonly debriefed: ReadonlyMap<string, number>;
}

/** Le ton du verdict : les deux mêmes teintes que les points des graphes. */
const RESULT_CLASSES: Readonly<Record<string, string>> = {
  victoire: "text-quench-500",
  defaite: "text-ember-400",
};

export function MatchList({ trend, debriefed }: MatchListProps) {
  const recent = [...trend].reverse();

  return (
    <Section
      title="Parties"
      caption="La plus récente en premier. Clique une ligne pour le scoreboard complet."
    >
      {recent.length === 0 ? (
        <Empty>Aucune partie sur cette fenêtre.</Empty>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {recent.map((match) => (
            <li key={match.matchId}>
              <MatchRow match={match} debriefed={debriefed.has(match.matchId)} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function MatchRow({
  match,
  debriefed,
}: {
  readonly match: TrendPoint;
  readonly debriefed: boolean;
}) {
  return (
    <a
      href={routeHash({ view: "valorant", matchId: match.matchId })}
      className="flex items-baseline justify-between gap-3 rounded-lg bg-steel-950/60 px-3 py-2 transition-colors hover:bg-steel-800/60"
    >
      <div className="min-w-0">
        <p className="truncate text-sm text-steel-200">
          {match.map ?? "Map inconnue"}
          {match.agent === null ? null : <span className="text-steel-500"> · {match.agent}</span>}
          {debriefed ? (
            <span className="ml-2 rounded border border-quench-600/50 px-1.5 py-0.5 align-middle text-[10px] font-medium text-quench-500">
              Débriefé
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-[11px] text-steel-500">
          <span className={match.result === null ? "" : (RESULT_CLASSES[match.result] ?? "")}>
            {resultLabel(match.result)}
          </span>
          {match.playedAt === null ? ` · ${UNKNOWN}` : ` · ${formatRunDate(match.playedAt)}`}
        </p>
      </div>
      <p className="shrink-0 text-right font-mono text-[11px] tabular-nums text-steel-400">
        {formatPercent(match.headshotPercent)} HS
        <span className="block">{formatAdr(match.adr)} ADR</span>
      </p>
    </a>
  );
}
