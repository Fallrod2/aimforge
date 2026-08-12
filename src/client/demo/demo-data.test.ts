/**
 * Le contrat de la démonstration publique : **aucun chiffre inventé**.
 *
 * C'est la seule chose que ces tests protègent, et c'est la seule qui compte.
 * Une démo est une promesse — « voilà ce que le produit calcule » — et elle
 * cesse d'en être une dès qu'un seuil, un overall ou un rang est écrit à la main
 * quelque part. Les assertions vérifient donc, dans cet ordre :
 *
 * 1. chaque score de démo est **exactement** un seuil du registre pour son
 *    scénario, pas une valeur plausible ;
 * 2. l'overall, le rang et le badge affichés sont **ceux que le moteur rend**
 *    pour ces scores-là — recalculés ici, sans passer par la fabrique ;
 * 3. les chiffres cités par le bloc SOURCES de la routine d'exemple sont ceux de
 *    la passe de démo, au formatage près.
 */

import { describe, expect, it } from "vitest";
import {
  computeBenchRunFor,
  getTierFor,
  listScenariosFor,
  listSubcategoriesFor,
} from "../../lib/energy";
import { storedRoutineSchema } from "../../shared/routine-contract";
import { formatEnergy } from "../format";
import {
  DEMO_ANCHOR,
  DEMO_BENCHMARK_ID,
  DEMO_TIER,
  demoBench,
  demoCurveLabel,
  demoNextRank,
  demoRoutine,
  demoScenarioCount,
  demoScores,
  demoSubcategoryLabel,
} from "./demo-data";

/** Un instant fixe : la démo date ses passes par rapport à « maintenant ». */
const NOW = new Date("2026-08-12T18:00:00.000Z");

const TIER = getTierFor(DEMO_BENCHMARK_ID, DEMO_TIER);

describe("scores de démo", () => {
  it("renseigne les 18 scénarios du palier, et rien d'autre", () => {
    const scores = demoScores();
    const names = listScenariosFor(DEMO_BENCHMARK_ID, DEMO_TIER).map((s) => s.name);

    expect(demoScenarioCount()).toBe(18);
    expect(Object.keys(scores).sort()).toEqual([...names].sort());
  });

  /** Le cœur : aucun score n'est une valeur choisie, chacun est une ancre. */
  it("pose chaque score pile sur un seuil du registre", () => {
    for (const shift of [-5, -3, -1, 0]) {
      const scores = demoScores(shift);

      for (const scenario of listScenariosFor(DEMO_BENCHMARK_ID, DEMO_TIER)) {
        const score = scores[scenario.name];

        expect(score, `${scenario.name} (décalage ${shift})`).toBeDefined();
        expect(scenario.thresholds, `${scenario.name} (décalage ${shift})`).toContain(score);
      }
    }
  });

  it("ancre le portrait sur Jade II, une ancre qui existe dans le palier", () => {
    expect(TIER.anchorLabels).toContain(DEMO_ANCHOR);
  });

  it("ne sort jamais du barème, même à décalage extrême", () => {
    for (const shift of [-99, 99]) {
      for (const scenario of listScenariosFor(DEMO_BENCHMARK_ID, DEMO_TIER)) {
        expect(scenario.thresholds, scenario.name).toContain(demoScores(shift)[scenario.name]);
      }
    }
  });
});

describe("passe de démo", () => {
  const { run, previous, history } = demoBench(NOW);

  /**
   * L'assertion qui tient tout : ce que la démo **affiche** est ce que le
   * moteur **calcule** pour ses scores. Le calcul est refait ici, à partir des
   * seuls scores, sans réutiliser ce que la fabrique a déjà dérivé.
   */
  it("affiche exactement ce que le moteur tire de ses scores", () => {
    for (const [index, entry] of history.entries()) {
      const shift = index - (history.length - 1);
      const computed = computeBenchRunFor(DEMO_BENCHMARK_ID, DEMO_TIER, demoScores(shift));

      expect(entry.overall, `passe ${entry.id}`).toBe(computed.overall);
      expect(entry.rank, `passe ${entry.id}`).toBe(computed.rank);
      expect(entry.complete, `passe ${entry.id}`).toBe(computed.complete);
      expect(entry.subcategories, `passe ${entry.id}`).toEqual(computed.subcategories);
      expect(entry.scores, `passe ${entry.id}`).toEqual(computed.scores);
    }
  });

  it("est complète : les 9 sous-catégories sont jouées, donc l'overall existe", () => {
    expect(run.subcategories).toHaveLength(9);
    expect(run.subcategories.every((sub) => sub.energy > 0)).toBe(true);
    expect(run.overall).toBeGreaterThan(0);
    expect(run.rank).not.toBeNull();
    expect(run.complete).toBe(true);
  });

  /**
   * Le portrait choisi, verrouillé : un tracking en retard sur le clicking, et
   * un overall juste sous le rang suivant. Ce n'est pas un chiffre écrit à la
   * main mais la conséquence du plan d'ancres — si quelqu'un le change, la
   * landing et la routine d'exemple ne racontent plus la même histoire.
   */
  it("porte le portrait annoncé : tracking en retard, rang suivant à portée", () => {
    const energyOf = (name: string) =>
      run.subcategories.find((sub) => sub.name === name)?.energy ?? 0;

    for (const tracking of ["Precise", "Reactive", "Control"]) {
      for (const clicking of ["Dynamic", "Static", "Linear"]) {
        expect(energyOf(tracking), `${tracking} vs ${clicking}`).toBeLessThan(energyOf(clicking));
      }
    }

    const upcoming = demoNextRank(run);

    expect(upcoming).not.toBeNull();
    expect(upcoming?.missing ?? 0).toBeGreaterThan(0);
  });

  it("raconte six semaines qui montent, la plus récente en dernier", () => {
    expect(history).toHaveLength(6);
    for (const [index, entry] of history.entries()) {
      if (index === 0) continue;
      const earlier = history[index - 1];

      expect(earlier).toBeDefined();
      expect(entry.overall, `passe ${entry.id}`).toBeGreaterThan(earlier?.overall ?? 0);
      expect(Date.parse(entry.date), `passe ${entry.id}`).toBeGreaterThan(
        Date.parse(earlier?.date ?? ""),
      );
    }
    expect(history.at(-1)).toEqual(run);
    expect(history.at(-2)).toEqual(previous);
  });

  it("date la dernière passe sur l'instant donné : une démo ne vieillit pas", () => {
    expect(run.date).toBe(NOW.toISOString());
  });

  it("garde les identifiants distincts, comme des lignes de base", () => {
    expect(new Set(history.map((entry) => entry.id)).size).toBe(history.length);
  });

  /**
   * La légende de la courbe n'est entendue que des lecteurs d'écran : si elle
   * était écrite à la main, elle mentirait sans que personne le voie.
   */
  it("décrit la courbe à partir des rangs réellement atteints", () => {
    const label = demoCurveLabel(demoBench(NOW));

    expect(label).toContain(`${history.length} passes`);
    expect(label).toContain(history[0]?.rank ?? "");
    expect(label).toContain(run.rank ?? "");
  });
});

describe("routine d'exemple", () => {
  const bench = demoBench(NOW);
  const routine = demoRoutine(bench, NOW);

  it("respecte le contrat de routine, comme une vraie", () => {
    expect(() => storedRoutineSchema.parse(routine)).not.toThrow();
  });

  /**
   * La démonstration du bloc SOURCES : elle ne vaut que si les valeurs citées
   * sont celles de la passe affichée juste au-dessus. Chaque puce est donc
   * confrontée à une énergie réelle de la démo.
   */
  it("ne cite que des chiffres pris sur la passe de démo", () => {
    const allowed = new Set<string>([
      formatEnergy(bench.run.overall),
      ...bench.run.subcategories.map((sub) => formatEnergy(sub.energy)),
    ]);
    const upcoming = demoNextRank(bench.run);

    if (upcoming !== null) allowed.add(formatEnergy(upcoming.missing));

    const sources = routine.sources ?? [];

    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(allowed, `${source.label} = ${source.value}`).toContain(source.value);
    }
  });

  it("nomme les sous-catégories citées avec leur catégorie", () => {
    expect(demoSubcategoryLabel("Control")).toBe("Tracking · Control");
    expect(demoSubcategoryLabel("Static")).toBe("Clicking · Static");
    expect(() => demoSubcategoryLabel("Inexistante")).toThrow();
  });

  it("cible bien le tracking, la faiblesse du portrait", () => {
    const labels = (routine.sources ?? []).map((source) => source.label).join(" ");

    expect(labels).toContain("Tracking · Control");
    expect(routine.titre.toLowerCase()).toContain("tracking");
  });

  /** Aucune donnée de partie dans la démo : la routine ne peut pas en supposer. */
  it("s'annonce bâtie sur le seul bench", () => {
    expect(routine.mode).toBe("bench_only");
    expect(routine.matchesUsed).toBe(0);
  });

  it("annonce une durée cohérente avec la somme de ses blocs", () => {
    const total = routine.blocs.reduce((sum, bloc) => sum + bloc.duree, 0);

    expect(total).toBe(routine.duree_totale);
    expect(routine.duree_totale).toBe(routine.duree_minutes);
  });
});

describe("plan d'ancres", () => {
  it("couvre les 9 sous-catégories du palier", () => {
    const subcategories = listSubcategoriesFor(DEMO_BENCHMARK_ID, DEMO_TIER);

    expect(subcategories).toHaveLength(9);
    // `demoScores` lève sur une sous-catégorie hors plan : l'appel suffit.
    expect(() => demoScores()).not.toThrow();
  });
});
