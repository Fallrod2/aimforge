/**
 * **La preuve du verrou multi-saison** (SPEC §5 quinquies).
 *
 * Tout le chantier tient à une promesse : *une passe enregistrée sous la S5
 * gardera ses valeurs S5 pour toujours, même quand la S6 sera la saison
 * courante*. Cette promesse ne se démontre pas avec une seule saison — il faut
 * une seconde saison qui donne des résultats **visiblement différents** sur les
 * mêmes scores. C'est ce que fait ce fichier, et c'est sa seule raison d'être.
 *
 * La saison S6 utilisée ici est **factice** et vit dans ce fichier de test :
 * elle n'est jamais versionnée comme donnée réelle, jamais déposée dans le
 * registre en dehors du test, et ses seuils sont **dérivés** de la S5 (× 10)
 * plutôt qu'inventés — la règle du projet reste que `voltaic-s5-data.json` est
 * la seule source de seuils.
 *
 * Multiplier les seuils par dix donne un écart qu'aucune erreur d'arrondi ne
 * peut produire : les mêmes 18 scores valent « Gold, 400 d'énergie » en S5 et
 * moins de 20 d'énergie sans aucun rang en S6.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  CURRENT_SEASON,
  computeBenchRunFor,
  EnergyError,
  getSeason,
  listSeasons,
  type ScoreMap,
  type SeasonId,
  type VoltaicData,
} from "../../lib/energy";
import { anchorEnergy, scoresAtAnchor } from "../../lib/energy/fixtures";
import {
  activeSeason,
  registerSeason,
  setCurrentSeason,
  withSeason,
} from "../../lib/energy/seasons";
import { type BenchRunStore, saveBenchRunTo } from "./bench-runs";
import { type BenchRunRow, type ScenarioScoreRow, toBenchRunDetail } from "./mapping";

const FAKE_S6 = "voltaic-s6-factice" as SeasonId;

/** Facteur appliqué aux seuils : assez grand pour qu'aucun doute ne subsiste. */
const HARDER = 10;

/**
 * Une saison factice : la S5 dont **tous les seuils de scénarios** sont dix
 * fois plus exigeants. Les ancres d'énergie, les rangs et les noms ne bougent
 * pas — on ne veut faire varier qu'une chose, sinon la démonstration ne dirait
 * plus laquelle compte.
 */
function harderSeason(data: VoltaicData): VoltaicData {
  return {
    ...data,
    tiers: data.tiers.map((tier) => ({
      ...tier,
      categories: tier.categories.map((category) => ({
        ...category,
        subcategories: category.subcategories.map((subcategory) => ({
          ...subcategory,
          scenarios: subcategory.scenarios.map((scenario) => ({
            ...scenario,
            thresholds: scenario.thresholds.map((threshold) => threshold * HARDER),
          })),
        })),
      })),
    })),
  };
}

/** Les 18 scores d'une passe Novice pile sur l'ancre « Gold » de la **S5**. */
let goldScores: ScoreMap;
/** L'énergie de cette ancre en S5 : la valeur que la passe doit garder. */
let goldEnergy: number;

const restorers: (() => void)[] = [];

/** Rend la saison `season` courante pour la durée du test en cours. */
function makeCurrent(season: SeasonId): void {
  restorers.push(setCurrentSeason(season));
}

beforeAll(() => {
  // Capturé **avant** toute bascule de saison : ces scores sont ceux du
  // tableur S5, et c'est bien eux qu'on relira sous une saison courante S6.
  goldScores = scoresAtAnchor("novice", "Gold");
  goldEnergy = anchorEnergy("novice", "Gold");

  const remove = registerSeason({
    id: FAKE_S6,
    data: harderSeason(getSeason(CURRENT_SEASON).data),
    kovaaks: { benchmarkIds: { novice: 1, intermediate: 2, advanced: 3 }, scenarioSuffix: " S6" },
  });

  return () => {
    remove();
  };
});

afterEach(() => {
  // La saison courante est un état de module : la laisser basculée
  // contaminerait les tests suivants, ce que ce fichier est mal placé pour se
  // permettre.
  while (restorers.length > 0) restorers.pop()?.();
});

function benchRow(season: string): BenchRunRow {
  return {
    id: 12,
    date: "2026-03-01T12:00:00+00:00",
    tier: "novice",
    overall: goldEnergy,
    rank: "Gold",
    complete: true,
    source: "manual",
    season,
  };
}

function scoreRows(scores: ScoreMap): ScenarioScoreRow[] {
  return Object.entries(scores).map(([scenario, score]) => ({ scenario, score, energy: 0 }));
}

describe("la saison factice diffère bien de la courante", () => {
  it("rend les mêmes scores nettement moins énergétiques", () => {
    const s5 = computeBenchRunFor(CURRENT_SEASON, "novice", goldScores);
    const s6 = computeBenchRunFor(FAKE_S6, "novice", goldScores);

    expect(s5.overall).toBe(goldEnergy);
    expect(s5.rank).toBe("Gold");
    expect(s6.overall).toBeLessThan(20);
    expect(s6.rank).toBeNull();
  });
});

describe("(a) une passe S5 relue sous une saison courante S6", () => {
  it("garde ses 9 sous-catégories S5, au chiffre près", () => {
    makeCurrent(FAKE_S6);

    const detail = toBenchRunDetail(benchRow(CURRENT_SEASON), scoreRows(goldScores));

    expect(detail.season).toBe(CURRENT_SEASON);
    expect(detail.subcategories).toHaveLength(9);
    // 400 d'énergie sur les neuf, exactement — la valeur de l'ancre « Gold »
    // du palier Novice en S5.
    expect(goldEnergy).toBe(400);
    for (const subcategory of detail.subcategories) {
      expect(subcategory.energy, subcategory.name).toBe(400);
    }
  });

  it("garde son overall et son rang S5 quand on les recalcule", () => {
    makeCurrent(FAKE_S6);

    const detail = toBenchRunDetail(benchRow(CURRENT_SEASON), scoreRows(goldScores));
    const recomputed = computeBenchRunFor(detail.season, detail.tier, goldScores);

    expect(recomputed.overall).toBe(400);
    expect(recomputed.rank).toBe("Gold");
    expect(recomputed.complete).toBe(true);
  });

  it("suit la colonne, pas la saison courante : la même ligne notée S6 change de valeurs", () => {
    makeCurrent(FAKE_S6);

    const asS5 = toBenchRunDetail(benchRow(CURRENT_SEASON), scoreRows(goldScores));
    const asS6 = toBenchRunDetail(benchRow(FAKE_S6), scoreRows(goldScores));

    expect(asS5.subcategories.every((sub) => sub.energy === 400)).toBe(true);
    expect(asS6.subcategories.every((sub) => sub.energy < 20)).toBe(true);
  });

  it("ordonne les scénarios avec le tableur de la saison de la passe", () => {
    makeCurrent(FAKE_S6);

    const detail = toBenchRunDetail(benchRow(CURRENT_SEASON), scoreRows(goldScores));

    expect(detail.scores).toHaveLength(18);
    expect(detail.scores[0]?.scenario).toBe("VT Pasu Novice");
  });
});

describe("(b) une nouvelle passe s'estampille la saison courante", () => {
  it("écrit « voltaic-s6 » quand la S6 est courante, avec les énergies S6", async () => {
    makeCurrent(FAKE_S6);

    const written: { season: string; overall: number }[] = [];
    const store: BenchRunStore = {
      async insertRun(run) {
        written.push({ season: run.season, overall: run.overall });
        return { ...benchRow(run.season), overall: run.overall, rank: run.rank };
      },
      async insertScores() {},
      async deleteRun() {},
    };

    await saveBenchRunTo(store, { tier: "novice", scores: goldScores });

    expect(written).toHaveLength(1);
    expect(written[0]?.season).toBe(FAKE_S6);
    // La passe est écrite avec les seuils de la saison qu'elle estampille :
    // l'étiquette et le calcul ne peuvent pas se contredire.
    expect(written[0]?.overall).toBeLessThan(20);
  });

  it("écrit la saison publiée le reste du temps", async () => {
    const written: string[] = [];
    const store: BenchRunStore = {
      async insertRun(run) {
        written.push(run.season);
        return benchRow(run.season);
      },
      async insertScores() {},
      async deleteRun() {},
    };

    await saveBenchRunTo(store, { tier: "novice", scores: goldScores });

    expect(written).toEqual([CURRENT_SEASON]);
  });
});

describe("(c) une saison inconnue ne se rabat jamais sur la courante", () => {
  it("refuse la ligne à la lecture", () => {
    expect(() => toBenchRunDetail(benchRow("voltaic-s99"), scoreRows(goldScores))).toThrow(
      EnergyError,
    );
    expect(() => toBenchRunDetail(benchRow("voltaic-s99"), scoreRows(goldScores))).toThrow(
      /Saison inconnue/,
    );
  });

  it("refuse aussi un calcul explicitement qualifié", () => {
    expect(() => computeBenchRunFor("voltaic-s99" as SeasonId, "novice", goldScores)).toThrow(
      EnergyError,
    );
  });

  it("refuse une saison retirée du registre après coup", () => {
    const ghost = "voltaic-s7-factice" as SeasonId;
    const remove = registerSeason({
      id: ghost,
      data: getSeason(CURRENT_SEASON).data,
      kovaaks: { benchmarkIds: { novice: 1, intermediate: 2, advanced: 3 }, scenarioSuffix: " S7" },
    });

    expect(() => computeBenchRunFor(ghost, "novice", goldScores)).not.toThrow();
    remove();
    expect(() => computeBenchRunFor(ghost, "novice", goldScores)).toThrow(EnergyError);
  });
});

describe("la portée de résolution est étanche", () => {
  it("rétablit la saison précédente, y compris imbriquée", () => {
    expect(withSeason(FAKE_S6, () => withSeason(CURRENT_SEASON, () => activeSeason()))).toBe(
      CURRENT_SEASON,
    );
    expect(withSeason(FAKE_S6, () => activeSeason())).toBe(FAKE_S6);
    expect(activeSeason()).toBe(CURRENT_SEASON);
  });

  it("rétablit la saison précédente même si le calcul lève", () => {
    expect(() =>
      withSeason(FAKE_S6, () => {
        throw new Error("boum");
      }),
    ).toThrow("boum");
    expect(activeSeason()).toBe(CURRENT_SEASON);
  });

  it("refuse un calcul asynchrone, dont la portée ne survivrait pas à un await", () => {
    expect(() => withSeason(FAKE_S6, () => Promise.resolve(1))).toThrow(EnergyError);
    expect(activeSeason()).toBe(CURRENT_SEASON);
  });
});

describe("le registre reste propre", () => {
  it("ne connaît que la saison publiée et la factice du fichier", () => {
    expect(listSeasons()).toEqual([CURRENT_SEASON, FAKE_S6]);
  });
});
