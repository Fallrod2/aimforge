/**
 * Synthèse live de la passe en cours : overall, rang, écart au rang suivant,
 * badge « Complete » et maillons faibles (l'overall est une moyenne
 * harmonique : c'est la sous-catégorie la plus basse qui le tire vers le bas).
 *
 * Au plafond du palier, la liste des maillons faibles s'efface au profit de
 * l'invitation à monter : neuf sous-catégories à `maxEnergy` ne désignent plus
 * de faiblesse, elles disent que le palier n'a plus rien à mesurer
 * (`weakest.ts`).
 *
 * Tant que le bench est incomplet, l'overall vaut 0 — c'est la règle métier, et
 * elle ne bouge pas. Ce qui bouge, c'est ce que l'écran en fait : au lieu d'un
 * « — · SANS RANG » identique pour celui qui n'a rien joué et pour celui qui a
 * bouclé huit sous-catégories sur neuf, le panneau affiche l'**énergie
 * partielle** (`partialEnergy`, SPEC V4-A §4.1a) — toujours étiquetée partielle,
 * toujours accompagnée du compte de sous-catégories, et jamais assortie d'un
 * rang. L'étiquette « Partiel » prend d'ailleurs la place exacte du badge de
 * rang : là où l'écran annonce d'ordinaire un rang, il annonce ici qu'il n'y en
 * a pas — et le chiffre à côté ne peut pas se lire comme un overall classé.
 */

import {
  type BenchmarkId,
  type ComputedBenchRun,
  getTierFor,
  partialEnergy,
  type TierId,
} from "../../lib/energy";
import { EnergyRail } from "../components/EnergyRail";
import { RankBadge } from "../components/RankBadge";
import { nextRankFor, rankColorForBenchmark } from "../energy-view";
import { formatEnergy } from "../format";
import { weakestViewFor } from "./weakest";

interface SummaryPanelProps {
  /**
   * Le benchmark dont ce panneau parle. **Obligatoire, et jamais déduit** : les
   * seuils de rang, les couleurs, `maxEnergy` et la liste des paliers lui
   * appartiennent (SPEC §5 quinquies).
   *
   * Il l'était de fait tant que le panneau ne vivait que sous
   * `ActiveBenchmarkProvider`, qui aligne le pointeur de la lib. Depuis V4-B, la
   * landing et la démonstration publique le rendent **hors du provider** — et
   * rien ne remet ce pointeur à sa valeur par défaut à la déconnexion. Un
   * visiteur dont la session précédente avait adopté un autre benchmark verrait
   * donc des chiffres résolus dans ce benchmark-là, ou une exception si le
   * palier n'y existe pas. D'où la prop : le panneau ne devine plus.
   */
  readonly benchmarkId: BenchmarkId;
  readonly tier: TierId;
  readonly computed: ComputedBenchRun;
  readonly scenarioCount: number;
  /** Bascule vers un autre palier, depuis le raccourci « palier supérieur ». */
  readonly onTierChange: (tier: TierId) => void;
}

export function SummaryPanel({
  benchmarkId,
  tier,
  computed,
  scenarioCount,
  onTierChange,
}: SummaryPanelProps) {
  const { overall, rank, complete, subcategories, scores } = computed;
  const color = rankColorForBenchmark(benchmarkId, tier, overall);
  const upcoming = nextRankFor(benchmarkId, tier, overall);
  const missing = subcategories.filter((sub) => sub.energy === 0);
  const weakest = weakestViewFor(benchmarkId, tier, subcategories);
  // `null` tant qu'aucune sous-catégorie n'est complète ; ignorée dès que
  // l'overall existe, puisqu'elle lui est alors égale.
  const partial =
    subcategories.length === 0 ? null : partialEnergy(subcategories.map((sub) => sub.energy));
  const showPartial = overall === 0 && partial !== null;

  return (
    <section className="rounded-xl border border-steel-700 bg-steel-900 p-5">
      <p className="text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
        {showPartial ? "Énergie partielle" : "Énergie overall"}
      </p>

      <div className="mt-2 flex items-end justify-between gap-3">
        <p
          className={`font-mono text-5xl leading-none font-semibold tracking-tight tabular-nums ${
            showPartial ? "text-steel-300" : ""
          }`}
          style={color ? { color, textShadow: `0 0 24px ${color}40` } : undefined}
        >
          {overall > 0 ? formatEnergy(overall) : showPartial ? formatEnergy(partial.energy) : "—"}
        </p>
        {showPartial ? <PartialTag /> : <RankBadge rank={rank} color={color} />}
      </div>

      <div className="mt-4">
        {/* La jauge d'énergie allume les graduations des rangs franchis : la
            nourrir d'une énergie partielle reviendrait à annoncer un rang à
            partir d'un bench incomplet. Elle cède donc la place à un décompte de
            sous-catégories, qui dit ce qu'il reste à jouer et rien d'autre. */}
        {showPartial ? (
          <SubcategoryProgress counted={partial.counted} total={partial.total} />
        ) : (
          <EnergyRail tier={tier} energy={overall} benchmarkId={benchmarkId} emphasis />
        )}
      </div>

      <p className="mt-3 text-xs text-steel-400">
        {missing.length > 0 ? (
          <>
            {showPartial ? (
              <>
                Énergie partielle sur {partial.counted}/{partial.total} sous-catégories :{" "}
                <span className="font-mono tabular-nums text-steel-200">
                  {formatEnergy(partial.energy)}
                </span>
                . Elle n'est pas enregistrée et ne donne aucun rang.{" "}
              </>
            ) : null}
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
            <TierCapped
              benchmarkId={benchmarkId}
              tier={tier}
              next={weakest.next}
              onTierChange={onTierChange}
            />
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

/**
 * L'étiquette « partiel ». Elle prend la place du badge de rang, elle ne
 * s'ajoute pas à lui : c'est ce qui rend impossible de lire le chiffre comme un
 * overall classé.
 */
function PartialTag() {
  return (
    <span className="inline-flex items-center rounded-full border border-steel-700 bg-steel-800/60 px-2.5 py-1 text-xs font-medium tracking-wide text-steel-300 uppercase">
      Partiel
    </span>
  );
}

/** Combien de sous-catégories sont jouées, sur le total du palier. */
function SubcategoryProgress({
  counted,
  total,
}: {
  readonly counted: number;
  readonly total: number;
}) {
  return (
    <div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-steel-800">
        <div
          className="h-full rounded-full bg-steel-500 transition-[width] duration-300 ease-out"
          style={{ width: `${(counted / total) * 100}%` }}
        />
      </div>
      <p className="mt-1.5 font-mono text-[11px] tabular-nums text-steel-500">
        {counted}/{total} sous-catégories
      </p>
    </div>
  );
}

interface TierCappedProps {
  /** Le benchmark dont les libellés de paliers sont lus. */
  readonly benchmarkId: BenchmarkId;
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
function TierCapped({ benchmarkId, tier, next, onTierChange }: TierCappedProps) {
  if (next === null) {
    return (
      <p className="mt-3 text-xs leading-relaxed text-steel-300">
        Les 9 sous-catégories sont au plafond du palier {getTierFor(benchmarkId, tier).label}. C'est
        le dernier du benchmark Voltaic : il n'y a rien au-dessus.
      </p>
    );
  }
  return (
    <>
      <p className="mt-3 text-xs leading-relaxed text-steel-300">
        Tout est au plafond du palier {getTierFor(benchmarkId, tier).label} — passe au palier
        supérieur.
      </p>
      <button
        type="button"
        onClick={() => onTierChange(next)}
        className="mt-3 w-full rounded-lg border border-ember-600/60 bg-ember-600/10 px-3 py-2 text-xs font-semibold text-ember-400 transition-colors hover:bg-ember-600/20"
      >
        Passer en {getTierFor(benchmarkId, next).label} →
      </button>
    </>
  );
}
