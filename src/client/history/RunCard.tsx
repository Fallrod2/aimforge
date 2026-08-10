/**
 * Une passe dans l'historique : ligne repliée (date, rang, overall) et détail
 * déplié (9 sous-catégories, 18 scénarios, suppression).
 *
 * Le détail se déplie sous la ligne plutôt que dans un panneau latéral : c'est
 * la seule forme qui tient à la fois sur 390 px et sur un écran large.
 */

import { getTierFor, listScenariosFor } from "../../lib/energy";
import { EnergyRail } from "../components/EnergyRail";
import { RankBadge } from "../components/RankBadge";
import type { BenchRunDetail, BenchRunSummary } from "../data";
import { formatEnergy, formatRunDate, formatScore, scenarioLabel } from "../format";
import { runRankColor } from "./series";

interface RunCardProps {
  readonly run: BenchRunSummary;
  readonly detail: BenchRunDetail | undefined;
  readonly detailError: string | null;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  /** `true` tant que l'utilisateur n'a pas confirmé la suppression. */
  readonly confirming: boolean;
  readonly deleting: boolean;
  readonly onAskDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
}

export function RunCard({
  run,
  detail,
  detailError,
  expanded,
  onToggle,
  confirming,
  deleting,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: RunCardProps) {
  // Les libellés, l'échelle et les seuils viennent de la saison **de la
  // passe** : une passe d'archive ne se relit pas avec les seuils du jour.
  const tier = getTierFor(run.season, run.tier);
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
            <RunDetailBody detail={detail} />
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-steel-800 pt-4">
            {confirming ? (
              <>
                <p className="mr-auto text-xs text-steel-400">Supprimer définitivement ?</p>
                <button
                  type="button"
                  onClick={onCancelDelete}
                  disabled={deleting}
                  className="rounded-lg border border-steel-700 px-3 py-1.5 text-xs font-medium text-steel-300 transition-colors hover:text-steel-100 disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={onConfirmDelete}
                  disabled={deleting}
                  className="rounded-lg bg-ember-600 px-3 py-1.5 text-xs font-semibold text-steel-100 transition-colors hover:bg-ember-500 disabled:opacity-50"
                >
                  {deleting ? "Suppression…" : "Confirmer"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onAskDelete}
                className="ml-auto rounded-lg border border-steel-700 px-3 py-1.5 text-xs font-medium text-steel-400 transition-colors hover:border-ember-600 hover:text-ember-400"
              >
                Supprimer cette passe
              </button>
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function RunDetailBody({ detail }: { readonly detail: BenchRunDetail }) {
  const tier = getTierFor(detail.season, detail.tier);
  const scoreByScenario = new Map(detail.scores.map((row) => [row.scenario, row]));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section>
        <h3 className="text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
          Sous-catégories
        </h3>
        <ul className="mt-3 space-y-2.5">
          {detail.subcategories.map((sub) => (
            <li key={sub.name} className="grid grid-cols-[7rem_1fr_4.5rem] items-center gap-3">
              <span className="truncate text-xs text-steel-300">{sub.name}</span>
              <EnergyRail tier={detail.tier} season={detail.season} energy={sub.energy} />
              <span className="text-right font-mono text-xs tabular-nums text-steel-200">
                {sub.energy > 0 ? (
                  formatEnergy(sub.energy)
                ) : (
                  <span className="text-steel-600">—</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
          Scénarios ({detail.scores.length}/{listScenariosFor(detail.season, detail.tier).length})
        </h3>
        <ul className="mt-3 divide-y divide-steel-800/70">
          {listScenariosFor(detail.season, detail.tier).map((scenario) => {
            const row = scoreByScenario.get(scenario.name);

            return (
              <li
                key={scenario.name}
                className="grid grid-cols-[1fr_4.5rem_4.5rem] items-center gap-2 py-1.5"
              >
                <span className="truncate text-xs text-steel-300" title={scenario.name}>
                  {scenarioLabel(scenario.name, tier.label)}
                </span>
                <span className="text-right font-mono text-xs tabular-nums text-steel-200">
                  {row ? formatScore(row.score) : <span className="text-steel-600">—</span>}
                </span>
                <span className="text-right font-mono text-xs tabular-nums text-steel-400">
                  {row ? formatEnergy(row.energy) : <span className="text-steel-600">—</span>}
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
