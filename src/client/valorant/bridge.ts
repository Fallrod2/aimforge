/**
 * Le pont bench ↔ in-game (SPEC §5 sexies, V2) : « ton aim training paie-t-il ? »
 *
 * Module pur. Il apparie deux séries qui n'ont **rien de comparable** — un
 * overall Voltaic (une énergie sur une échelle de palier) et un pourcentage de
 * tirs à la tête en partie — et son travail est justement de les apparier sans
 * mentir.
 *
 * ## Ce qu'il ne fait pas, et pourquoi
 *
 * Il ne normalise **aucune valeur**. Ni indice base 100 au premier point, ni
 * mise à l'échelle sur un axe commun, ni double axe des ordonnées. Les trois
 * fabriquent la même illusion : deux courbes qui se croisent au même endroit
 * de l'image alors que le point de croisement dépend entièrement du cadrage
 * choisi. Un indice base 100 est en plus instable ici — le premier bench de la
 * fenêtre décide de toute la lecture, et il peut être une mauvaise passe.
 *
 * Ce qu'il fabrique, c'est **un axe du temps commun** : une borne basse et une
 * borne haute partagées, que deux mini-graphes empilés utilisent à l'identique.
 * Chacun garde son unité et son axe des ordonnées étiqueté ; la seule chose que
 * l'œil compare est la position dans le temps — la seule qui soit réellement
 * commune aux deux séries. C'est la « normalisation honnête » demandée : elle
 * porte sur l'abscisse, pas sur les valeurs.
 *
 * ## Deux cadrages non négociables
 *
 * 1. **Un seul palier.** Deux paliers Voltaic n'ont pas la même échelle (500 en
 *    Novice n'est pas 500 en Advanced) : les mélanger dessinerait une falaise à
 *    chaque changement de palier. Le pont retient le palier de la passe la plus
 *    récente de la saison, et le dit.
 * 2. **Une seule saison**, celle que l'appelant passe : les seuils changent
 *    d'une saison à l'autre (SPEC §5 quinquies).
 *
 * Et une garde : le recouvrement des deux séries est mesuré. Deux courbes qui
 * ne partagent aucun jour ne disent rien l'une de l'autre, et l'écran doit
 * pouvoir le dire au lieu de laisser croire à une corrélation.
 */

import type { SeasonId, TierId } from "../../lib/energy";
import type { BenchRunSummary, TrendPoint } from "../data";

const DAY_MS = 86_400_000;

/** Un point daté d'une des deux séries. */
export interface BridgePoint {
  /** Instant du point, en millisecondes : l'abscisse commune aux deux graphes. */
  readonly t: number;
  readonly value: number;
  /** De quoi retrouver la ligne d'origine dans l'infobulle. */
  readonly key: string;
}

export interface Bridge {
  /** Bornes de l'axe du temps, partagées par les deux mini-graphes. */
  readonly from: number;
  readonly to: number;
  /** Overall des passes de bench du palier retenu, du plus ancien au plus récent. */
  readonly bench: readonly BridgePoint[];
  /** HS% des parties datées, du plus ancien au plus récent. */
  readonly ingame: readonly BridgePoint[];
  /** Le palier des passes tracées ; l'écran le nomme. */
  readonly tier: TierId;
  /**
   * Jours où les deux séries coexistent réellement.
   *
   * Zéro veut dire que le bench et les parties ne se recouvrent pas du tout —
   * les deux courbes sont côte à côte dans le temps, pas en regard.
   */
  readonly overlapDays: number;
}

/** Points minimaux par série : à un seul point, il n'y a pas de tendance. */
const MIN_POINTS = 2;

/**
 * Le pont, ou `null` s'il n'y a rien d'honnête à montrer.
 *
 * `null` couvre : aucune passe de la saison, aucune partie datée avec un HS%,
 * ou moins de deux points d'un côté. L'écran affiche alors ce qui manque, sans
 * cadre de graphe vide.
 */
export function buildBridge(
  runs: readonly BenchRunSummary[],
  trend: readonly TrendPoint[],
  season: SeasonId,
): Bridge | null {
  const seasonRuns = [...runs]
    .filter((run) => run.season === season && run.overall > 0)
    .sort((left, right) => left.date.localeCompare(right.date) || left.id - right.id);
  // Le palier de la passe la plus récente : c'est celui qu'on joue, donc celui
  // dont la progression a un sens à côté des parties d'aujourd'hui.
  const tier = seasonRuns.at(-1)?.tier;

  if (tier === undefined) return null;

  const bench = seasonRuns
    .filter((run) => run.tier === tier)
    .map((run) => ({ t: Date.parse(run.date), value: run.overall, key: String(run.id) }))
    .filter((entry) => !Number.isNaN(entry.t));

  const ingame = trend
    .map((point) => ({
      t: point.playedAt === null ? Number.NaN : Date.parse(point.playedAt),
      value: point.headshotPercent,
      key: point.matchId,
    }))
    .filter((entry): entry is BridgePoint => !Number.isNaN(entry.t) && entry.value !== null)
    .sort((left, right) => left.t - right.t);

  if (bench.length < MIN_POINTS || ingame.length < MIN_POINTS) return null;

  const spans = [spanOf(bench), spanOf(ingame)];

  return {
    from: Math.min(...spans.map((span) => span.from)),
    to: Math.max(...spans.map((span) => span.to)),
    bench,
    ingame,
    tier,
    overlapDays: overlapDays(spans[0], spans[1]),
  };
}

interface Span {
  readonly from: number;
  readonly to: number;
}

/** L'étendue d'une série déjà triée. */
function spanOf(points: readonly BridgePoint[]): Span {
  return { from: points[0]?.t ?? 0, to: points.at(-1)?.t ?? 0 };
}

/**
 * Le recouvrement de deux étendues, en jours entiers arrondis au plus proche.
 *
 * Deux étendues qui se touchent en un instant ne comptent pas pour un jour :
 * `0` veut dire « rien à comparer », et c'est ce que l'écran dira.
 */
function overlapDays(left: Span | undefined, right: Span | undefined): number {
  if (left === undefined || right === undefined) return 0;

  const from = Math.max(left.from, right.from);
  const to = Math.min(left.to, right.to);

  return to <= from ? 0 : Math.round((to - from) / DAY_MS);
}
