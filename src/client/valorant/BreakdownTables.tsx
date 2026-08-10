/**
 * Les tableaux par agent et par map (SPEC §5 sexies, V2).
 *
 * **Ils ne suivent pas le sélecteur de période, et ils le disent.** Le contrat
 * de `api/valorant/stats` ne ventile par agent et par map que sur l'ensemble
 * des parties importées ; la série temporelle, elle, ne porte ni kills ni morts
 * — un K/D par agent et par fenêtre ne peut donc pas être recalculé dans le
 * navigateur sans inventer une seconde vérité à côté de celle que le coach
 * citera. Plutôt qu'un sélecteur qui ne ferait rien à un tableau sur deux,
 * cette section vit à part avec sa propre portée annoncée. Le jour où le
 * serveur ventilera par période, elle rejoindra la fenêtre.
 *
 * Le tri est refait ici (`rankBreakdowns`) : « par volume » est une promesse
 * d'écran, pas une propriété de la réponse réseau.
 */

import type { StatBreakdown } from "../data";
import { rankBreakdowns } from "./breakdowns";
import { formatAdr, formatCount, formatPercent, formatRatio } from "./display";
import { Empty, Section } from "./ui";

interface BreakdownTablesProps {
  readonly byAgent: readonly StatBreakdown[];
  readonly byMap: readonly StatBreakdown[];
}

export function BreakdownTables({ byAgent, byMap }: BreakdownTablesProps) {
  return (
    <Section title="Par agent · par map" caption="Sur l'ensemble des parties importées.">
      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownTable heading="Agent" breakdowns={byAgent} noun="agent" />
        <BreakdownTable heading="Map" breakdowns={byMap} noun="map" />
      </div>
    </Section>
  );
}

interface BreakdownTableProps {
  readonly heading: string;
  readonly breakdowns: readonly StatBreakdown[];
  /** Le nom de ce qu'on compte, pour la ligne « et N autres ». */
  readonly noun: string;
}

function BreakdownTable({ heading, breakdowns, noun }: BreakdownTableProps) {
  const { rows, hidden, hiddenMatches } = rankBreakdowns(breakdowns);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[11px] tracking-wide text-steel-500 uppercase">{heading}</p>
        <Empty>Aucune partie ne porte cette information pour l'instant.</Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[20rem] border-collapse text-sm">
          <thead>
            <tr className="text-[11px] tracking-wide text-steel-500 uppercase">
              <th scope="col" className="py-1.5 pr-2 text-left font-medium">
                {heading}
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                Parties
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                Winrate
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                K/D
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                HS%
              </th>
              <th scope="col" className="py-1.5 pl-2 text-right font-medium">
                ADR
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-steel-800/60">
                <th scope="row" className="py-1.5 pr-2 text-left font-normal text-steel-200">
                  {row.key}
                </th>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-steel-400">
                  {formatCount(row.totals.matches)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-steel-300">
                  {formatPercent(row.totals.winrate)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-steel-400">
                  {formatRatio(row.totals.kd)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-steel-400">
                  {formatPercent(row.totals.headshotPercent)}
                </td>
                <td className="py-1.5 pl-2 text-right font-mono tabular-nums text-steel-400">
                  {formatAdr(row.totals.adr)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden === 0 ? null : (
        <p className="text-[11px] text-steel-500">
          Et {hidden} autre{hidden > 1 ? "s" : ""} {noun}
          {hidden > 1 ? "s" : ""}, {formatCount(hiddenMatches)} partie
          {hiddenMatches > 1 ? "s" : ""} au total.
        </p>
      )}
    </div>
  );
}
