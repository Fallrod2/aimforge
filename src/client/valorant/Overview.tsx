/**
 * La vue d'ensemble : le rang du moment, et les quatre chiffres de la fenêtre
 * choisie (SPEC §5 sexies, V2).
 *
 * Les quatre tuiles ne calculent rien : elles lisent `periods[…]` tel que
 * `api/valorant/stats` l'a rendu. C'est important — ce sont les chiffres que le
 * coach citera (V4) et que la routine vérifiera (V5), et ils n'ont qu'une
 * source. Un écran qui les recalculerait finirait par afficher autre chose que
 * ce que le modèle a lu.
 */

import { Segmented } from "../components/Segmented";
import type { StatTotals } from "../data";
import { formatAdr, formatCount, formatPercent, formatRatio, UNKNOWN } from "./display";
import { PERIOD_CAPTIONS, PERIOD_OPTIONS, type PeriodId } from "./periods";
import { Empty, Section } from "./ui";

/*
 * Le rang et son bouton « Rafraîchir » vivaient ici (`RankHeader`) tant que
 * Valorant était un onglet. Depuis V6, c'est `ValorantPanel` qui les porte, en
 * tête du bloc de l'accueil : deux rangs et deux boutons de rafraîchissement
 * l'un sous l'autre auraient posé la question de savoir lequel dit vrai.
 */

interface OverviewProps {
  readonly totals: StatTotals;
  readonly period: PeriodId;
  readonly onPeriodChange: (period: PeriodId) => void;
}

export function Overview({ totals, period, onPeriodChange }: OverviewProps) {
  return (
    <Section
      title="Vue d'ensemble"
      caption={`${formatCount(totals.matches)} partie${totals.matches > 1 ? "s" : ""} ${PERIOD_CAPTIONS[period]}`}
      control={
        <Segmented
          label="Fenêtre d'analyse"
          options={PERIOD_OPTIONS}
          value={period}
          onChange={onPeriodChange}
        />
      }
    >
      {totals.matches === 0 ? (
        <Empty>
          Aucune partie sur cette fenêtre. Élargis la période, ou rafraîchis pour aller chercher les
          dernières parties classées.
        </Empty>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile
              label="Winrate"
              value={formatPercent(totals.winrate)}
              detail={`${totals.wins} V · ${totals.losses} D${totals.draws > 0 ? ` · ${totals.draws} É` : ""}`}
            />
            <Tile
              label="K/D"
              value={formatRatio(totals.kd)}
              detail={`${formatCount(totals.kills)} kills · ${formatCount(totals.deaths)} morts`}
            />
            <Tile
              label="HS%"
              value={formatPercent(totals.headshotPercent)}
              detail="moyenne par partie"
            />
            <Tile label="ADR" value={formatAdr(totals.adr)} detail="dégâts par round" />
          </dl>
          <p className="text-[11px] leading-relaxed text-steel-500">
            « {UNKNOWN} » veut dire que la source n'a pas renseigné la mesure sur ces parties — pas
            qu'elle vaut zéro.
          </p>
        </>
      )}
    </Section>
  );
}

interface TileProps {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}

function Tile({ label, value, detail }: TileProps) {
  return (
    <div className="rounded-lg bg-steel-950/60 p-3">
      <dt className="text-[11px] tracking-wide text-steel-500 uppercase">{label}</dt>
      <dd className="mt-1.5 font-mono text-xl leading-none font-semibold text-steel-100">
        {value}
      </dd>
      <p className="mt-1.5 text-[11px] text-steel-500">{detail}</p>
    </div>
  );
}
