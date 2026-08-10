/**
 * Synthèse live de la passe en cours : overall, rang, écart au rang suivant,
 * badge « Complete » et maillons faibles (l'overall est une moyenne
 * harmonique : c'est la sous-catégorie la plus basse qui le tire vers le bas).
 *
 * Au plafond du palier, la liste des maillons faibles s'efface au profit de
 * l'invitation à monter : neuf sous-catégories à `maxEnergy` ne désignent plus
 * de faiblesse, elles disent que le palier n'a plus rien à mesurer
 * (`weakest.ts`).
 */

import { type ComputedBenchRun, getTier, type TierId } from "../../lib/energy";
import { EnergyRail } from "../components/EnergyRail";
import { RankBadge } from "../components/RankBadge";
import { nextRank, rankColorFor } from "../energy-view";
import { formatEnergy } from "../format";
import { weakestView } from "./weakest";

interface SummaryPanelProps {
  readonly tier: TierId;
  readonly computed: ComputedBenchRun;
  readonly scenarioCount: number;
  /** Bascule vers un autre palier, depuis le raccourci « palier supérieur ». */
  readonly onTierChange: (tier: TierId) => void;
}

export function SummaryPanel({ tier, computed, scenarioCount, onTierChange }: SummaryPanelProps) {
  const { overall, rank, complete, subcategories, scores } = computed;
  const color = rankColorFor(tier, overall);
  const upcoming = nextRank(tier, overall);
  const missing = subcategories.filter((sub) => sub.energy === 0);
  const weakest = weakestView(tier, subcategories);

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

      {weakest.kind === "empty" ? null : (
        <div className="mt-5 border-t border-steel-800 pt-4">
          <p className="text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
            {weakest.kind === "capped" ? "Palier au plafond" : "Maillons faibles"}
          </p>
          {weakest.kind === "capped" ? (
            <TierCapped tier={tier} next={weakest.next} onTierChange={onTierChange} />
          ) : (
            <ul className="mt-3 space-y-2">
              {weakest.subcategories.map((sub) => (
                <li key={sub.name} className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate text-steel-300">{sub.name}</span>
                  <span className="font-mono tabular-nums text-steel-100">
                    {formatEnergy(sub.energy)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

interface TierCappedProps {
  readonly tier: TierId;
  /** Le palier au-dessus, `null` quand il n'y en a plus (Advanced). */
  readonly next: TierId | null;
  readonly onTierChange: (tier: TierId) => void;
}

/**
 * Ce qui remplace les maillons faibles quand tout est au plafond.
 *
 * Le raccourci bascule le palier plutôt que de le faire chercher dans le
 * sélecteur : c'est le seul geste qui reste à faire ici. Au sommet d'Advanced
 * il n'y a rien à proposer — on le dit sobrement, sans inventer une suite.
 */
function TierCapped({ tier, next, onTierChange }: TierCappedProps) {
  if (next === null) {
    return (
      <p className="mt-3 text-xs leading-relaxed text-steel-300">
        Les 9 sous-catégories sont au plafond du palier {getTier(tier).label}. C'est le dernier du
        benchmark Voltaic : il n'y a rien au-dessus.
      </p>
    );
  }
  return (
    <>
      <p className="mt-3 text-xs leading-relaxed text-steel-300">
        Tout est au plafond du palier {getTier(tier).label} — passe au palier supérieur.
      </p>
      <button
        type="button"
        onClick={() => onTierChange(next)}
        className="mt-3 w-full rounded-lg border border-ember-600/60 bg-ember-600/10 px-3 py-2 text-xs font-semibold text-ember-400 transition-colors hover:bg-ember-600/20"
      >
        Passer en {getTier(next).label} →
      </button>
    </>
  );
}
