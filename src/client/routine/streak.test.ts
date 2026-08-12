/**
 * La série et les séances des sept derniers jours.
 *
 * Tout se joue sur le **jour local** et sur des cas de bordure qu'un calcul en
 * millisecondes rate : le changement d'heure, deux séances le même jour, la
 * séance datée de demain par une horloge de travers.
 *
 * Les instants sont donc construits à partir de **composantes locales**
 * (`new Date(y, m, d, h)`) puis sérialisés comme la base le fait. Écrire
 * « 12:00Z » ferait dépendre les assertions du fuseau de la machine de test :
 * au-delà de UTC+12, midi UTC tombe le lendemain.
 */

import { describe, expect, it } from "vitest";
import { computeStreak, type DoneRoutine, formatStreak } from "./streak";

/** L'instant local `day` à `hour` heures, tel qu'il serait enregistré. */
function at(day: string, hour = 12): Date {
  const [year, month, date] = day.split("-").map(Number);

  return new Date(year ?? 0, (month ?? 1) - 1, date ?? 1, hour);
}

/** Une routine faite (ou non) ce jour-là. */
function routine(day: string, done = true, hour = 12): DoneRoutine {
  return { date: at(day, hour).toISOString(), done };
}

describe("computeStreak", () => {
  it("ne compte rien sans routine", () => {
    expect(computeStreak([], at("2026-08-12"))).toEqual({ days: 0, sessions: 0 });
  });

  it("ignore les routines non faites : cocher est le geste qui compte", () => {
    const list = [routine("2026-08-12", false), routine("2026-08-11", false)];

    expect(computeStreak(list, at("2026-08-12"))).toEqual({ days: 0, sessions: 0 });
  });

  it("compte les jours consécutifs jusqu'à aujourd'hui", () => {
    const list = [routine("2026-08-12"), routine("2026-08-11"), routine("2026-08-10")];

    expect(computeStreak(list, at("2026-08-12")).days).toBe(3);
  });

  it("garde la série vivante quand rien n'a encore été fait aujourd'hui", () => {
    // Il est midi, la séance du jour n'est pas faite : la série d'hier n'est pas
    // perdue, elle est seulement en sursis jusqu'à minuit.
    const list = [routine("2026-08-11"), routine("2026-08-10")];

    expect(computeStreak(list, at("2026-08-12")).days).toBe(2);
  });

  it("casse la série sur un jour sauté", () => {
    const list = [routine("2026-08-12"), routine("2026-08-10"), routine("2026-08-09")];

    expect(computeStreak(list, at("2026-08-12")).days).toBe(1);
  });

  it("oublie une série close avant-hier : elle n'est plus en cours", () => {
    const list = [routine("2026-08-09"), routine("2026-08-08"), routine("2026-08-07")];

    expect(computeStreak(list, at("2026-08-12")).days).toBe(0);
  });

  it("ne compte deux routines d'un même jour que pour un jour de série", () => {
    const list = [
      routine("2026-08-12", true, 9),
      routine("2026-08-12", true, 20),
      routine("2026-08-11"),
    ];
    const streak = computeStreak(list, at("2026-08-12"));

    expect(streak.days).toBe(2);
    // …mais pour deux **séances** : c'est bien deux fois qu'on s'est entraîné.
    expect(streak.sessions).toBe(3);
  });

  it("compte les séances sur sept jours glissants, aujourd'hui compris", () => {
    const list = [
      routine("2026-08-12"),
      routine("2026-08-09"),
      // Le septième jour de la fenêtre : dedans.
      routine("2026-08-06"),
      // Le huitième : dehors.
      routine("2026-08-05"),
    ];

    expect(computeStreak(list, at("2026-08-12")).sessions).toBe(3);
  });

  it("ignore une routine datée de demain plutôt que de gonfler le compteur", () => {
    const list = [routine("2026-08-13"), routine("2026-08-12")];

    expect(computeStreak(list, at("2026-08-12"))).toEqual({ days: 1, sessions: 1 });
  });

  it("ignore une date illisible sans casser le calcul", () => {
    const list = [{ date: "pas une date", done: true }, routine("2026-08-12")];

    expect(computeStreak(list, at("2026-08-12"))).toEqual({ days: 1, sessions: 1 });
  });

  it("traverse un changement d'heure sans perdre un jour", () => {
    // Dernier dimanche d'octobre 2026 : l'Europe recule d'une heure. Un calcul
    // en « 24 h par jour » compterait 3 jours au lieu de 4 sur cette fenêtre.
    const list = [
      routine("2026-10-26"),
      routine("2026-10-25"),
      routine("2026-10-24"),
      routine("2026-10-23"),
    ];

    expect(computeStreak(list, at("2026-10-26")).days).toBe(4);
  });
});

describe("formatStreak", () => {
  it("se tait sur une série d'un jour et une séance : il n'y a rien à annoncer", () => {
    expect(formatStreak({ days: 1, sessions: 1 })).toBeNull();
    expect(formatStreak({ days: 0, sessions: 0 })).toBeNull();
  });

  it("annonce la série dès deux jours, avec les séances de la fenêtre", () => {
    expect(formatStreak({ days: 4, sessions: 5 })).toBe("Série : 4 jours · 5 séances sur 7 jours");
  });

  it("annonce les séances seules quand la série n'a pas repris", () => {
    // Deux séances cette semaine, mais pas deux jours d'affilée : « Série : 1
    // jour » ne voudrait rien dire, le compteur de la semaine, si.
    expect(formatStreak({ days: 1, sessions: 3 })).toBe("3 séances sur 7 jours");
  });

  it("n'écrit jamais de singulier, parce que les deux seuils l'interdisent", () => {
    // Les deux branches partent de 2 : « 1 jour » et « 1 séance » ne peuvent pas
    // sortir d'ici, et le code n'a donc pas d'accord à gérer.
    expect(formatStreak({ days: 2, sessions: 2 })).toBe("Série : 2 jours · 2 séances sur 7 jours");
    expect(formatStreak({ days: 0, sessions: 2 })).toBe("2 séances sur 7 jours");
  });
});
