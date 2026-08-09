import { describe, expect, it } from "vitest";
import { type DatedRoutine, isSameLocalDay, routineOfToday } from "./today";

/** Une date locale, construite champ par champ pour ne pas dépendre du fuseau. */
function local(year: number, month: number, day: number, hour = 12, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute);
}

function routine(id: number, date: Date, done = false): DatedRoutine {
  return { id, date: date.toISOString(), done };
}

describe("isSameLocalDay", () => {
  it("reconnaît deux instants du même jour local", () => {
    expect(isSameLocalDay(local(2026, 8, 9, 1), local(2026, 8, 9, 23))).toBe(true);
  });

  it("sépare deux jours consécutifs", () => {
    expect(isSameLocalDay(local(2026, 8, 9, 23, 59), local(2026, 8, 10, 0, 1))).toBe(false);
  });

  it("ne confond pas le même quantième de deux mois ou de deux années", () => {
    expect(isSameLocalDay(local(2026, 7, 9), local(2026, 8, 9))).toBe(false);
    expect(isSameLocalDay(local(2025, 8, 9), local(2026, 8, 9))).toBe(false);
  });
});

describe("routineOfToday", () => {
  const now = local(2026, 8, 9, 18);

  it("rend null sur une liste vide", () => {
    expect(routineOfToday([], now)).toBeNull();
  });

  it("rend la routine du jour non faite", () => {
    const today = routine(2, local(2026, 8, 9, 9));

    expect(routineOfToday([routine(1, local(2026, 8, 8, 9)), today], now)?.id).toBe(2);
  });

  it("ignore une routine d'hier, même non faite", () => {
    expect(routineOfToday([routine(1, local(2026, 8, 8, 23))], now)).toBeNull();
  });

  it("ignore une routine du jour déjà faite", () => {
    expect(routineOfToday([routine(1, local(2026, 8, 9, 9), true)], now)).toBeNull();
  });

  it("rend la plus récente quand il y en a plusieurs aujourd'hui", () => {
    const routines = [
      routine(1, local(2026, 8, 9, 8)),
      routine(2, local(2026, 8, 9, 16)),
      routine(3, local(2026, 8, 9, 11)),
    ];

    expect(routineOfToday(routines, now)?.id).toBe(2);
  });

  it("départage deux routines de la même seconde par l'identifiant", () => {
    const stamp = local(2026, 8, 9, 10);

    expect(routineOfToday([routine(7, stamp), routine(9, stamp)], now)?.id).toBe(9);
  });

  it("saute une routine faite pour rendre la précédente encore ouverte", () => {
    const routines = [routine(1, local(2026, 8, 9, 8)), routine(2, local(2026, 8, 9, 16), true)];

    expect(routineOfToday(routines, now)?.id).toBe(1);
  });

  it("ignore une date illisible plutôt que de planter", () => {
    const broken = { id: 1, date: "pas une date", done: false };

    expect(routineOfToday([broken, routine(2, local(2026, 8, 9, 9))], now)?.id).toBe(2);
  });

  it("compte le jour dans le fuseau local, pas en UTC", () => {
    // 23 h locales : le même instant est souvent déjà « demain » en UTC (ou
    // « hier »). C'est bien la journée du joueur qui décide.
    const late = local(2026, 8, 9, 23, 30);

    expect(routineOfToday([routine(1, late)], local(2026, 8, 9, 23, 45))?.id).toBe(1);
  });
});
