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
import type { LinkedAccount, StatTotals } from "../data";
import { formatAdr, formatCount, formatPercent, formatRatio, UNKNOWN } from "./display";
import { PERIOD_CAPTIONS, PERIOD_OPTIONS, type PeriodId } from "./periods";
import { Empty, Section } from "./ui";

interface RankHeaderProps {
  readonly account: LinkedAccount;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
  /** Ce qui n'a pas pu être mis à jour, dit en petit et sans alarme. */
  readonly notice: string | null;
}

/**
 * Rang, RR et dernière variation — lus sur le compte lié (`riot_mmr`), pas
 * demandés à la volée : l'écran montre d'abord ce qu'il sait, le
 * rafraîchissement corrige ensuite. Une vue qui attendrait une API non
 * officielle avant d'afficher quoi que ce soit serait vide à chaque ouverture.
 */
export function RankHeader({ account, refreshing, onRefresh, notice }: RankHeaderProps) {
  const mmr = account.riotMmr;
  const change = mmr?.lastChange ?? null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div>
          <p className="text-2xl leading-none font-semibold text-steel-100">
            {mmr?.tier ?? "Rang inconnu"}
          </p>
          <p className="mt-1.5 text-xs text-steel-500">
            {account.externalId}
            {mmr?.rr === null || mmr?.rr === undefined ? null : ` · ${mmr.rr} RR`}
            {change === null ? null : (
              <span className={change >= 0 ? "text-quench-500" : "text-ember-400"}>
                {" "}
                ({change > 0 ? "+" : ""}
                {change})
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          disabled={refreshing}
          onClick={onRefresh}
          className="ml-auto rounded-lg border border-steel-700 px-3 py-1.5 text-[11px] font-medium text-steel-300 transition-colors hover:border-steel-600 hover:text-steel-100 disabled:cursor-not-allowed disabled:text-steel-600"
        >
          {refreshing ? "Mise à jour…" : "Rafraîchir"}
        </button>
      </div>
      {notice === null ? null : (
        <p aria-live="polite" className="text-[11px] leading-relaxed text-steel-500">
          {notice}
        </p>
      )}
    </div>
  );
}

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
