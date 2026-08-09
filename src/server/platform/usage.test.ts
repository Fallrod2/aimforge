/**
 * Ce que ces tests protègent : les deux erreurs qui rendent un tableau d'usage
 * faux **sans avoir l'air faux**.
 *
 * 1. **Les jours vides.** Un jour sans activité doit sortir à zéro, pas
 *    disparaître. Un tableau qui saute les jours creux dessine une courbe
 *    plate là où il y a eu un trou, et personne ne s'en aperçoit ;
 * 2. **le découpage UTC.** Les compteurs sont datés en UTC (migrations 0003 et
 *    0007) ; les debriefs et les routines portent un horodatage complet. Un
 *    debrief de 23 h 30 UTC rangé selon le fuseau de la machine qui exécute la
 *    fonction changerait de colonne selon l'endroit d'où on regarde.
 */

import { describe, expect, it } from "vitest";
import { aggregateUsage, type UsageInput, utcDay, windowDays } from "./usage";

const TODAY = "2026-08-09";

function input(patch: Partial<UsageInput> = {}): UsageInput {
  return {
    today: TODAY,
    days: 14,
    aiUsage: [],
    importUsage: [],
    debriefs: [],
    routines: [],
    personalConfigs: 0,
    aiGlobalDailyLimit: null,
    ...patch,
  };
}

describe("windowDays", () => {
  it("rend la fenêtre complète, du plus ancien au plus récent, aujourd'hui inclus", () => {
    const days = windowDays(TODAY, 14);

    expect(days).toHaveLength(14);
    expect(days[0]).toBe("2026-07-27");
    expect(days.at(-1)).toBe(TODAY);
  });

  it("franchit un changement de mois sans se tromper de grille", () => {
    expect(windowDays("2026-03-02", 4)).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  it("rend une fenêtre vide plutôt que d'inventer sur une entrée absurde", () => {
    expect(windowDays("pas une date", 14)).toEqual([]);
    expect(windowDays(TODAY, 0)).toEqual([]);
  });
});

describe("utcDay", () => {
  it("range un instant de fin de journée dans sa journée UTC, pas dans la locale", () => {
    expect(utcDay(new Date("2026-08-09T23:30:00.000Z"))).toBe("2026-08-09");
    expect(utcDay(new Date("2026-08-10T00:10:00.000Z"))).toBe("2026-08-10");
  });
});

describe("aggregateUsage", () => {
  it("rend une fenêtre complète de jours à zéro quand rien ne s'est passé", () => {
    const usage = aggregateUsage(input());

    expect(usage.days).toHaveLength(14);
    expect(usage.days.every((day) => day.activeUsers === 0)).toBe(true);
    expect(usage.today.day).toBe(TODAY);
    expect(usage.totals.coachPlatform).toBe(0);
  });

  it("additionne les compteurs plateforme et compte les utilisateurs distincts", () => {
    const usage = aggregateUsage(
      input({
        aiUsage: [
          { user_id: "a", day: TODAY, coach_count: 3, routine_count: 1 },
          { user_id: "b", day: TODAY, coach_count: 2, routine_count: 0 },
          { user_id: "a", day: "2026-08-08", coach_count: 5, routine_count: 5 },
        ],
        importUsage: [{ user_id: "c", day: TODAY, kovaaks_count: 4, riot_link_count: 1 }],
      }),
    );

    expect(usage.today.coachPlatform).toBe(5);
    expect(usage.today.routinePlatform).toBe(1);
    expect(usage.today.kovaaksImports).toBe(4);
    expect(usage.today.riotLinks).toBe(1);
    expect(usage.today.activeUsers).toBe(3);

    expect(usage.totals.coachPlatform).toBe(10);
    // `a` apparaît deux jours : le cumul compte des personnes, pas des lignes.
    expect(usage.totals.activeUsers).toBe(3);
  });

  it("range les debriefs et routines stockés dans leur journée UTC", () => {
    const usage = aggregateUsage(
      input({
        debriefs: [
          { user_id: "a", date: "2026-08-09T23:59:00.000Z" },
          { user_id: "a", date: "2026-08-08T00:00:01.000Z" },
        ],
        routines: [{ user_id: "b", date: "2026-08-09T00:00:00.000Z" }],
      }),
    );

    expect(usage.today.debriefsStored).toBe(1);
    expect(usage.today.routinesStored).toBe(1);
    expect(usage.days.find((day) => day.day === "2026-08-08")?.debriefsStored).toBe(1);
  });

  it("laisse lire la part personnelle : ce qui est stocké, moins ce qui a été compté", () => {
    // SPEC §5 quater : `ai_usage` ne compte que la clé de la plateforme. Trois
    // debriefs stockés pour un seul compté ⇒ deux payés par leurs auteurs.
    const usage = aggregateUsage(
      input({
        aiUsage: [{ user_id: "a", day: TODAY, coach_count: 1, routine_count: 0 }],
        debriefs: [
          { user_id: "a", date: `${TODAY}T08:00:00.000Z` },
          { user_id: "b", date: `${TODAY}T09:00:00.000Z` },
          { user_id: "b", date: `${TODAY}T10:00:00.000Z` },
        ],
        personalConfigs: 1,
      }),
    );

    expect(usage.today.debriefsStored - usage.today.coachPlatform).toBe(2);
    expect(usage.personalConfigs).toBe(1);
  });

  it("ignore les lignes hors fenêtre plutôt que de gonfler le cumul", () => {
    const usage = aggregateUsage(
      input({
        aiUsage: [{ user_id: "a", day: "2026-01-01", coach_count: 99, routine_count: 99 }],
        debriefs: [{ user_id: "a", date: "2020-01-01T00:00:00.000Z" }],
      }),
    );

    expect(usage.totals.coachPlatform).toBe(0);
    expect(usage.totals.debriefsStored).toBe(0);
    expect(usage.totals.activeUsers).toBe(0);
  });

  it("écarte une ligne qu'on ne sait pas dater plutôt que de la ranger au mauvais jour", () => {
    const usage = aggregateUsage(input({ debriefs: [{ user_id: "a", date: "jamais" }] }));

    expect(usage.totals.debriefsStored).toBe(0);
  });

  it("ne compte pas actif un utilisateur dont tous les compteurs du jour sont à zéro", () => {
    // La ligne existe (elle a été créée un autre jour, ou remise à zéro) : elle
    // ne dit rien d'une activité.
    const usage = aggregateUsage(
      input({ aiUsage: [{ user_id: "a", day: TODAY, coach_count: 0, routine_count: 0 }] }),
    );

    expect(usage.today.activeUsers).toBe(0);
  });

  it("reporte le plafond global tel quel, pour situer le compteur du jour", () => {
    expect(aggregateUsage(input({ aiGlobalDailyLimit: 100 })).aiGlobalDailyLimit).toBe(100);
    expect(aggregateUsage(input()).aiGlobalDailyLimit).toBeNull();
  });

  it("n'expose aucun identifiant d'utilisateur", () => {
    // SPEC §5 quater : « sans données personnelles au-delà du nécessaire ».
    // Le nécessaire est un cardinal, jamais une identité.
    const usage = aggregateUsage(
      input({
        aiUsage: [
          { user_id: "8099c09e-utilisateur", day: TODAY, coach_count: 1, routine_count: 0 },
        ],
      }),
    );

    expect(JSON.stringify(usage)).not.toContain("8099c09e-utilisateur");
  });
});
