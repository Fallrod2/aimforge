/**
 * Jauge d'énergie. Toutes les jauges d'un palier partagent la même échelle
 * (0 → maxEnergy) : une colonne de jauges se lit d'un coup d'œil.
 *
 * L'acier porte le remplissage, la couleur officielle du rang ne s'allume que
 * sur la tête de jauge et sur les graduations franchies.
 */

import { type BenchmarkId, currentBenchmark, type TierId } from "../../lib/energy";
import { railFractionFor, rankColorForBenchmark, rankTicksFor } from "../energy-view";

interface EnergyRailProps {
  readonly tier: TierId;
  readonly energy: number;
  /**
   * Benchmark dont l'échelle et les graduations s'appliquent. Par défaut le
   * courante — c'est le cas du tracker, qui montre la saisie en cours. Une
   * jauge qui décrit une passe **enregistrée** doit passer `run.benchmarkId` :
   * `maxEnergy` et les seuils de rang changent d'un benchmark à l'autre.
   */
  readonly benchmarkId?: BenchmarkId;
  /** Jauge de synthèse : plus épaisse, graduations nommées. */
  readonly emphasis?: boolean;
}

export function EnergyRail({
  tier,
  energy,
  benchmarkId = currentBenchmark(),
  emphasis = false,
}: EnergyRailProps) {
  const fraction = railFractionFor(benchmarkId, tier, energy);
  const color = rankColorForBenchmark(benchmarkId, tier, energy);
  const ticks = rankTicksFor(benchmarkId, tier, energy);
  const width = `${fraction * 100}%`;

  return (
    <div className={`relative w-full rounded-full bg-steel-800 ${emphasis ? "h-2.5" : "h-1.5"}`}>
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-steel-500 transition-[width] duration-300 ease-out"
        style={{ width }}
      />
      {ticks.map((tick) => (
        <span
          key={tick.name}
          aria-hidden="true"
          className="absolute inset-y-0 w-px"
          style={{
            left: `${tick.fraction * 100}%`,
            backgroundColor: tick.reached ? tick.color : "var(--color-steel-700)",
            opacity: tick.reached ? 0.9 : 1,
          }}
        />
      ))}
      {fraction > 0 && color !== null ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-[3px] rounded-full transition-[left] duration-300 ease-out"
          style={{
            left: `calc(${width} - 3px)`,
            backgroundColor: color,
            boxShadow: `0 0 8px ${color}`,
          }}
        />
      ) : null}
    </div>
  );
}
