/**
 * L'objectif de rang du palier : le choisir, et voir ce qui en sépare
 * (SPEC V4-A §4.5).
 *
 * Tous les chiffres affichés ici viennent du registre (`goal.ts` lit
 * `anchorLabels` et `scenario.thresholds`) : aucun seuil n'est écrit dans ce
 * fichier, et les rangs proposés sont ceux du palier courant du benchmark
 * actif — un autre benchmark en proposerait d'autres sans qu'on y touche.
 *
 * Trois scénarios manquants sont nommés, pas dix-huit : la liste doit dire quoi
 * lancer maintenant, et les plus proches du seuil sont les seuls qui répondent
 * à cette question. Le reste est compté.
 */

import type { TierId } from "../../lib/energy";
import { formatScore, scenarioLabel } from "../format";
import type { GoalProgress } from "./goal";
import { goalRanks } from "./goal";

/** Combien de scénarios manquants on nomme avant de compter le reste. */
const NAMED_GAPS = 3;

interface GoalPanelProps {
  readonly tier: TierId;
  readonly tierLabel: string;
  /** Le rang visé, `null` tant qu'aucun n'est choisi. */
  readonly goal: string | null;
  /** L'avancement, `null` s'il n'y a pas d'objectif (ou s'il est étranger au palier). */
  readonly progress: GoalProgress | null;
  readonly onGoalChange: (rank: string | null) => void;
}

export function GoalPanel({ tier, tierLabel, goal, progress, onGoalChange }: GoalPanelProps) {
  const ranks = goalRanks(tier);
  const selectId = `goal-${tier}`;

  return (
    <section className="rounded-xl border border-steel-800 bg-steel-900/60 p-4">
      <label
        htmlFor={selectId}
        className="text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase"
      >
        Objectif de rang
      </label>
      <select
        id={selectId}
        value={goal ?? ""}
        onChange={(event) => onGoalChange(event.target.value === "" ? null : event.target.value)}
        className="mt-2 w-full rounded-lg border border-steel-700 bg-steel-800 px-2.5 py-2 text-xs text-steel-100 transition-colors hover:border-steel-600"
      >
        <option value="">Aucun</option>
        {ranks.map((rank) => (
          <option key={rank.name} value={rank.name}>
            {rank.name} ({tierLabel})
          </option>
        ))}
      </select>

      {progress === null ? (
        <p className="mt-3 text-xs leading-relaxed text-steel-500">
          Choisis un rang : le tracker compte alors les scénarios déjà au seuil et nomme ceux qui
          manquent, avec le score exact à battre.
        </p>
      ) : (
        <GoalDetail progress={progress} tierLabel={tierLabel} />
      )}
    </section>
  );
}

function GoalDetail({
  progress,
  tierLabel,
}: {
  readonly progress: GoalProgress;
  readonly tierLabel: string;
}) {
  const named = progress.missing.slice(0, NAMED_GAPS);
  const rest = progress.missing.length - named.length;

  return (
    <>
      <p className="mt-3 text-xs leading-relaxed text-steel-300">
        Objectif {progress.rank} :{" "}
        <span className="font-mono tabular-nums text-steel-100">
          {progress.reached}/{progress.total}
        </span>{" "}
        scénarios au seuil.
      </p>

      {progress.missing.length === 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-steel-400">
          Les {progress.total} scénarios sont au seuil {progress.rank} : le badge « {progress.rank}{" "}
          Complete » tombe à l'enregistrement.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[11px] text-steel-500">Il te manque :</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {named.map((gap) => (
              <li key={gap.scenario} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-steel-300" title={gap.scenario}>
                  {scenarioLabel(gap.scenario, tierLabel)}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-steel-400">
                  {formatScore(gap.threshold)}
                </span>
              </li>
            ))}
          </ul>
          {rest > 0 ? (
            <p className="mt-1.5 text-[11px] text-steel-500">
              et {rest} autre{rest > 1 ? "s" : ""} scénario{rest > 1 ? "s" : ""}.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
