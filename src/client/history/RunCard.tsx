/**
 * Une passe dans l'historique : ligne repliée (date, rang, overall) et détail
 * déplié (9 sous-catégories, 18 scénarios, suppression).
 *
 * Le détail se déplie sous la ligne plutôt que dans un panneau latéral : c'est
 * la seule forme qui tient à la fois sur 390 px et sur un écran large.
 */

import { getTierFor, listScenariosFor } from "../../lib/energy";
import { DeltaBadge } from "../components/Delta";
import { ConfirmButton } from "../components/Destructive";
import { EnergyRail } from "../components/EnergyRail";
import { RankBadge } from "../components/RankBadge";
import type { BenchRunDetail, BenchRunSummary } from "../data";
import { formatEnergy, formatRunDate, formatScore, scenarioLabel } from "../format";
import { deltaOf, subcategoryDeltas } from "../run-delta";
import { runRankColor } from "./series";

interface RunCardProps {
  readonly run: BenchRunSummary;
  readonly detail: BenchRunDetail | undefined;
  /**
   * Le détail de la passe **précédente** du même palier et du même benchmark
   * (§4.4), `undefined` tant qu'il n'est pas chargé — ou pour toujours s'il
   * s'agit de la première passe. Les écarts sont alors simplement absents :
   * aucun zéro trompeur, aucun « ▲ +447 » tiré d'une passe qui n'existe pas.
   */
  readonly previous: BenchRunDetail | undefined;
  readonly detailError: string | null;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  /** Le bouton attend sa confirmation (`../components/confirm.ts`). */
  readonly deleteArmed: boolean;
  /** Les deux appuis passent par le même rappel : la machine les distingue. */
  readonly onPressDelete: () => void;
}

export function RunCard({
  run,
  detail,
  previous,
  detailError,
  expanded,
  onToggle,
  deleteArmed,
  onPressDelete,
}: RunCardProps) {
  // Les libellés, l'échelle et les seuils viennent du benchmark **de la
  // passe** : une passe d'archive ne se relit pas avec les seuils du jour.
  const tier = getTierFor(run.benchmarkId, run.tier);
  const color = runRankColor(run);
  const panelId = `run-${run.id}-detail`;

  return (
    <li className="overflow-hidden rounded-xl border border-steel-800 bg-steel-900/60">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-steel-850"
      >
        {/* Sur téléphone le badge passe sous la date : à trois colonnes, la
            date se faisait tronquer et perdait son année. */}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-steel-100">{formatRunDate(run.date)}</span>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-[11px] tracking-wide text-steel-500 uppercase">{tier.label}</span>
            <span className="sm:hidden">
              <RankBadge rank={run.rank} color={color} complete={run.complete} size="sm" />
            </span>
          </span>
        </span>

        <span className="hidden sm:inline-flex">
          <RankBadge rank={run.rank} color={color} complete={run.complete} size="sm" />
        </span>

        <span
          className="w-20 shrink-0 text-right font-mono text-base tabular-nums"
          style={color ? { color } : { color: "var(--color-steel-500)" }}
        >
          {run.overall > 0 ? formatEnergy(run.overall) : "—"}
        </span>

        <Chevron open={expanded} />
      </button>

      {expanded ? (
        <div id={panelId} className="border-t border-steel-800 px-4 py-4">
          {detailError !== null ? (
            <p className="text-xs text-ember-400">{detailError}</p>
          ) : detail === undefined ? (
            <p className="text-xs text-steel-500">Chargement du détail…</p>
          ) : (
            <RunDetailBody detail={detail} previous={previous} />
          )}

          {/* La suppression tient désormais dans un seul bouton (V5-A §5.4) :
              il devient « Supprimer définitivement ? » pendant quatre secondes,
              puis la passe part — avec cinq secondes pour l'annuler. Le panneau
              de confirmation qui poussait la mise en page vers le bas a
              disparu : rien ne bouge sous le doigt entre les deux appuis. */}
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-steel-800 pt-4">
            <ConfirmButton
              label="Supprimer cette passe"
              question="Supprimer définitivement ?"
              armed={deleteArmed}
              onPress={onPressDelete}
              className="ml-auto"
            />
          </div>
        </div>
      ) : null}
    </li>
  );
}

function RunDetailBody({
  detail,
  previous,
}: {
  readonly detail: BenchRunDetail;
  readonly previous: BenchRunDetail | undefined;
}) {
  const tier = getTierFor(detail.benchmarkId, detail.tier);
  const scoreByScenario = new Map(detail.scores.map((row) => [row.scenario, row]));
  // Deux benchs incomplets ont tous deux un overall à 0 : leur « écart nul »
  // ne dirait rien de la progression réelle. On ne compare que des overalls.
  const overallDelta =
    previous === undefined || detail.overall === 0 || previous.overall === 0
      ? null
      : deltaOf(detail.overall, previous.overall);
  const deltas = new Map(
    subcategoryDeltas(detail.subcategories, previous?.subcategories ?? []).map((entry) => [
      entry.name,
      entry.delta,
    ]),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {previous === undefined ? null : (
        <p className="flex flex-wrap items-baseline gap-2 text-xs text-steel-500 lg:col-span-2">
          <span>vs passe du {formatRunDate(previous.date)} :</span>
          {overallDelta === null ? (
            <span className="text-steel-400">écart d'overall indisponible (bench incomplet)</span>
          ) : (
            <DeltaBadge delta={overallDelta} label="Énergie overall" />
          )}
        </p>
      )}

      <section>
        <h3 className="text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
          Sous-catégories
        </h3>
        <ul className="mt-3 space-y-2.5">
          {detail.subcategories.map((sub) => (
            <li key={sub.name} className="grid grid-cols-[7rem_1fr_5.5rem] items-center gap-3">
              <span className="truncate text-xs text-steel-300">{sub.name}</span>
              <EnergyRail tier={detail.tier} benchmarkId={detail.benchmarkId} energy={sub.energy} />
              {/* L'écart s'empile sous l'énergie plutôt que d'ouvrir une
                  quatrième colonne : sur 390 px, celle-ci prenait sa place à la
                  jauge, qui est justement ce qui rend la ligne lisible. */}
              <span className="flex flex-col items-end">
                <span className="font-mono text-xs tabular-nums text-steel-200">
                  {sub.energy > 0 ? (
                    formatEnergy(sub.energy)
                  ) : (
                    <span className="text-steel-500">—</span>
                  )}
                </span>
                <DeltaBadge delta={deltas.get(sub.name) ?? null} label={sub.name} size="sm" />
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
          Scénarios ({detail.scores.length}/
          {listScenariosFor(detail.benchmarkId, detail.tier).length})
        </h3>
        <ul className="mt-3 divide-y divide-steel-800/70">
          {listScenariosFor(detail.benchmarkId, detail.tier).map((scenario) => {
            const row = scoreByScenario.get(scenario.name);

            return (
              <li
                key={scenario.name}
                className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center gap-2 py-1.5"
              >
                <span className="truncate text-xs text-steel-300" title={scenario.name}>
                  {scenarioLabel(scenario.name, tier.label, detail.benchmarkId)}
                </span>
                <span className="text-right font-mono text-xs tabular-nums text-steel-200">
                  {row ? formatScore(row.score) : <span className="text-steel-500">—</span>}
                </span>
                <span className="text-right font-mono text-xs tabular-nums text-steel-400">
                  {row ? formatEnergy(row.energy) : <span className="text-steel-500">—</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className={`size-3 shrink-0 text-steel-500 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M2 4.5 6 8.5 10 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
