/**
 * Synthèse live de la passe en cours : overall, rang, écart au rang suivant,
 * badge « Complete » et maillons faibles (l'overall est une moyenne
 * harmonique : c'est la sous-catégorie la plus basse qui le tire vers le bas).
 */

import type { TierId } from "../../lib/energy";
import type { ComputedBenchRun } from "../../server/api/compute";
import { EnergyRail } from "../components/EnergyRail";
import { RankBadge } from "../components/RankBadge";
import { nextRank, rankColorFor } from "../energy-view";
import { formatEnergy } from "../format";

interface SummaryPanelProps {
  readonly tier: TierId;
  readonly computed: ComputedBenchRun;
  readonly scenarioCount: number;
}

const WEAKEST_COUNT = 3;

export function SummaryPanel({ tier, computed, scenarioCount }: SummaryPanelProps) {
  const { overall, rank, complete, subcategories, scores } = computed;
  const color = rankColorFor(tier, overall);
  const upcoming = nextRank(tier, overall);
  const missing = subcategories.filter((sub) => sub.energy === 0);
  const weakest = [...subcategories]
    .filter((sub) => sub.energy > 0)
    .sort((a, b) => a.energy - b.energy)
    .slice(0, WEAKEST_COUNT);

  return (
    <section className="rounded-xl border border-steel-700 bg-steel-900 p-5">
      <p className="text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
        Énergie overall
      </p>

      <div className="mt-2 flex items-end justify-between gap-3">
        <p
          className="font-mono text-5xl leading-none font-semibold tracking-tight tabular-nums"
          style={color ? { color, textShadow: `0 0 24px ${color}40` } : undefined}
        >
          {overall > 0 ? formatEnergy(overall) : "—"}
        </p>
        <RankBadge rank={rank} color={color} />
      </div>

      <div className="mt-4">
        <EnergyRail tier={tier} energy={overall} emphasis />
      </div>

      <p className="mt-3 text-xs text-steel-400">
        {missing.length > 0 ? (
          <>
            Bench incomplet : {missing.length} sous-catégorie{missing.length > 1 ? "s" : ""} sans
            score. L'overall reste à 0 tant qu'il en manque une.
          </>
        ) : upcoming ? (
          <>
            Il manque{" "}
            <span className="font-mono tabular-nums text-steel-200">
              {formatEnergy(upcoming.missing)}
            </span>{" "}
            d'énergie pour {upcoming.rank.name}.
          </>
        ) : (
          "Dernier rang du palier atteint."
        )}
      </p>

      {complete && rank !== null ? (
        <p className="mt-3">
          <RankBadge rank={rank} color={color} complete />
        </p>
      ) : null}

      <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-steel-800 pt-4 text-xs">
        <div>
          <dt className="text-steel-500">Scénarios saisis</dt>
          <dd className="mt-1 font-mono text-sm tabular-nums text-steel-100">
            {scores.length}/{scenarioCount}
          </dd>
        </div>
        <div>
          <dt className="text-steel-500">Sous-catégories</dt>
          <dd className="mt-1 font-mono text-sm tabular-nums text-steel-100">
            {subcategories.length - missing.length}/{subcategories.length}
          </dd>
        </div>
      </dl>

      {weakest.length > 0 ? (
        <div className="mt-5 border-t border-steel-800 pt-4">
          <p className="text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
            Maillons faibles
          </p>
          <ul className="mt-3 space-y-2">
            {weakest.map((sub) => (
              <li key={sub.name} className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-steel-300">{sub.name}</span>
                <span className="font-mono tabular-nums text-steel-100">
                  {formatEnergy(sub.energy)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
