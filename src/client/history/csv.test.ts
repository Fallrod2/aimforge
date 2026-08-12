import { describe, expect, it } from "vitest";
import { benchRunsCsv, CSV_BOM, type CsvRun, csvFileName } from "./csv";

const SCENARIOS = ["VT Pasu Novice", "VT Popcorn Novice"];

function run(overrides: Partial<CsvRun> = {}): CsvRun {
  return {
    date: "2026-03-10T09:05:00.000Z",
    tierLabel: "Novice",
    overall: 447.3617,
    rank: "Gold",
    complete: false,
    scores: { "VT Pasu Novice": 807, "VT Popcorn Novice": 100 },
    ...overrides,
  };
}

/** Les lignes du fichier, BOM retiré, pour parler du contenu seul. */
function lines(csv: string): readonly string[] {
  return csv.slice(CSV_BOM.length).split("\r\n");
}

describe("benchRunsCsv", () => {
  it("commence par un BOM UTF-8 : sans lui, Excel FR casse les accents", () => {
    expect(benchRunsCsv([], SCENARIOS).startsWith(CSV_BOM)).toBe(true);
  });

  it("écrit l'en-tête même sans passe", () => {
    expect(lines(benchRunsCsv([], SCENARIOS))).toEqual([
      "date;palier;overall;rang;complete;VT Pasu Novice;VT Popcorn Novice",
    ]);
  });

  it("sépare par des points-virgules et décime par des virgules (Excel FR)", () => {
    const row = lines(benchRunsCsv([run()], SCENARIOS, { timeZone: "UTC" }))[1];

    expect(row).toBe("10/03/2026 09:05;Novice;447,36;Gold;non;807;100");
  });

  it("laisse vides les colonnes de scénario d'une passe d'un autre palier", () => {
    const other = run({ tierLabel: "Intermediate", scores: {}, rank: null, complete: true });
    const row = lines(benchRunsCsv([other], SCENARIOS, { timeZone: "UTC" }))[1];

    expect(row).toBe("10/03/2026 09:05;Intermediate;447,36;;oui;;");
  });

  it("laisse l'overall vide plutôt que d'écrire 0 sur un bench incomplet", () => {
    // 0 est la valeur métier d'un bench incomplet ; dans un tableur, elle se
    // moyennerait avec les autres et tirerait la courbe vers le bas.
    const row = lines(benchRunsCsv([run({ overall: 0, rank: null })], SCENARIOS))[1];

    expect(row?.split(";")[2]).toBe("");
  });

  it("garde une ligne par passe, dans l'ordre reçu", () => {
    const csv = benchRunsCsv([run({ rank: "Gold" }), run({ rank: "Silver" })], SCENARIOS);

    expect(lines(csv)).toHaveLength(3);
    expect(lines(csv)[1]).toContain("Gold");
    expect(lines(csv)[2]).toContain("Silver");
  });

  it("échappe les champs qui contiennent le séparateur, un guillemet ou un saut de ligne", () => {
    const csv = benchRunsCsv([run({ tierLabel: 'Palier "spécial"; test' })], SCENARIOS);

    expect(lines(csv)[1]).toContain('"Palier ""spécial""; test"');
  });

  it("échappe aussi un nom de scénario contenant le séparateur", () => {
    const csv = benchRunsCsv([], ["VT Pasu; Novice"]);

    expect(lines(csv)[0]).toContain('"VT Pasu; Novice"');
  });

  it("écrit un score décimal avec la virgule", () => {
    const csv = benchRunsCsv([run({ scores: { "VT Pasu Novice": 88.5 } })], SCENARIOS);

    expect(lines(csv)[1]?.split(";")[5]).toBe("88,5");
  });
});

describe("csvFileName", () => {
  it("nomme le fichier par le barème, le palier et le jour", () => {
    expect(csvFileName("voltaic-s5", "Novice", new Date("2026-03-10T09:05:00.000Z"))).toBe(
      "aimforge-voltaic-s5-novice-2026-03-10.csv",
    );
  });

  it("n'accepte aucun caractère susceptible d'ouvrir un chemin", () => {
    expect(csvFileName("bench/../s5", "Palier Été", new Date("2026-03-10T00:00:00.000Z"))).toBe(
      "aimforge-bench-s5-palier-ete-2026-03-10.csv",
    );
  });
});
