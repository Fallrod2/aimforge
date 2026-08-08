import { describe, expect, it } from "vitest";
import {
  formatChartDate,
  formatDelta,
  formatEnergy,
  formatRunDate,
  formatScore,
  scenarioLabel,
} from "./format";

/** Neutralise les espaces insécables posés par Intl (U+202F, U+00A0). */
function plain(text: string): string {
  return text.replace(/\s/g, " ");
}

const RUN_DATE = "2026-03-01T13:00:00.000Z";

describe("formatEnergy", () => {
  it("garde toujours 2 décimales : une énergie se compare chiffre à chiffre", () => {
    expect(formatEnergy(451.96)).toBe("451,96");
    expect(formatEnergy(400)).toBe("400,00");
    expect(formatEnergy(0)).toBe("0,00");
  });

  it("arrondit à la 2e décimale", () => {
    expect(formatEnergy(447.3567)).toBe("447,36");
  });
});

describe("formatScore", () => {
  it("reste entier quand le score l'est", () => {
    expect(plain(formatScore(1162))).toBe("1 162");
    expect(formatScore(807)).toBe("807");
  });

  it("montre les décimales seulement quand il y en a", () => {
    expect(plain(formatScore(1290.5))).toBe("1 290,5");
  });
});

describe("formatDelta", () => {
  it("signe explicitement un écart positif", () => {
    expect(formatDelta(11)).toBe("+11");
  });

  it("laisse le signe moins porter un écart négatif", () => {
    expect(formatDelta(-11)).toBe("-11");
  });

  it("n'invente pas de signe sur zéro", () => {
    expect(formatDelta(0)).toBe("0");
  });
});

describe("formatRunDate", () => {
  it("affiche la date et l'heure de la passe", () => {
    expect(plain(formatRunDate(RUN_DATE, "UTC"))).toBe("1 mars 2026, 13:00");
  });

  it("rend la date dans le fuseau demandé", () => {
    expect(plain(formatRunDate(RUN_DATE, "Europe/Paris"))).toBe("1 mars 2026, 14:00");
  });
});

describe("formatChartDate", () => {
  it("réduit l'abscisse du graphe au jour et au mois", () => {
    expect(plain(formatChartDate(RUN_DATE, "UTC"))).toBe("1 mars");
  });
});

describe("scenarioLabel", () => {
  it("retire le préfixe VT et le palier, déjà à l'écran", () => {
    expect(scenarioLabel("VT Pasu Novice", "Novice")).toBe("Pasu");
    expect(scenarioLabel("VT 1w4ts Intermediate", "Intermediate")).toBe("1w4ts");
  });

  it("ne coupe le palier qu'en fin de nom", () => {
    expect(scenarioLabel("VT Advanced Angle Strafes Advanced", "Advanced")).toBe(
      "Advanced Angle Strafes",
    );
  });

  it("laisse intact un nom qui ne suit pas la convention", () => {
    expect(scenarioLabel("Custom Scenario", "Novice")).toBe("Custom Scenario");
  });
});
