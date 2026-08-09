import { describe, expect, it } from "vitest";
import type { MatchSummary } from "../../client/data/linked-accounts-contract";
import { formatMatchStats, matchStatsFrom } from "./match-stats";

const FULL: MatchSummary = {
  matchId: "0f7d3b21-2f2c-4a6e-9a1b-8c2d5e6f7a8b",
  playedAt: "2026-08-09T18:12:00.000Z",
  map: "Ascent",
  mode: "Compétitif",
  agent: "Jett",
  kills: 18,
  deaths: 14,
  assists: 5,
  adr: 152,
  headshotPercent: 21,
  roundsWon: 11,
  roundsLost: 13,
  result: "defaite",
};

/** Le même match, mais dont la source n'a renseigné aucune statistique. */
const BARE: MatchSummary = {
  matchId: FULL.matchId,
  playedAt: null,
  map: null,
  mode: null,
  agent: null,
  kills: null,
  deaths: null,
  assists: null,
  adr: null,
  headshotPercent: null,
  roundsWon: null,
  roundsLost: null,
  result: null,
};

describe("formatMatchStats", () => {
  it("rend un fait par ligne, dans l'ordre de lecture", () => {
    expect(formatMatchStats(FULL)).toBe(
      [
        "Partie Valorant importée automatiquement (résumé du fournisseur de données).",
        "",
        "- Map : Ascent",
        "- Mode : Compétitif",
        "- Agent : Jett",
        "- Résultat : Défaite 11-13",
        "- K/D/A : 18/14/5",
        "- ADR : 152",
        "- Tirs à la tête : 21 %",
        "- Jouée le : 2026-08-09T18:12:00.000Z",
      ].join("\n"),
    );
  });

  it("dit d'où vient le texte : le modèle ne doit pas le lire comme un collage", () => {
    // La ligne d'en-tête est ce qui distingue un import d'un copier-coller ;
    // sans elle, un debrief pourrait reprocher au joueur d'avoir mal collé.
    expect(formatMatchStats(BARE).startsWith("Partie Valorant importée")).toBe(true);
  });

  it("omet une statistique absente plutôt que d'écrire « inconnu »", () => {
    const text = formatMatchStats({ ...FULL, adr: null, headshotPercent: null });

    expect(text).not.toContain("ADR");
    expect(text).not.toContain("Tirs à la tête");
    // Le reste est intact : une donnée manquante n'en emporte pas d'autres.
    expect(text).toContain("- K/D/A : 18/14/5");
  });

  it("n'écrit un KDA que si les trois compteurs sont là", () => {
    expect(formatMatchStats({ ...FULL, assists: null })).not.toContain("K/D/A");
  });

  it("écrit le score seul quand le verdict manque, et le verdict seul sans score", () => {
    expect(formatMatchStats({ ...FULL, result: null })).toContain("- Résultat : Score 11-13");
    expect(formatMatchStats({ ...FULL, roundsWon: null })).toContain("- Résultat : Défaite");
  });

  it("reste exploitable quand la source n'a rien renseigné", () => {
    const text = formatMatchStats(BARE);

    // Un match sans statistique reste débriefable : le bench et le profil
    // suffisent à dire quelque chose, et le texte le dit au modèle.
    expect(text).toContain("Aucune statistique exploitable");
    expect(text.trim()).not.toBe("");
  });
});

describe("matchStatsFrom", () => {
  it("accepte un payload conforme au schéma qui l'a écrit", () => {
    expect(matchStatsFrom(FULL)).toContain("- Map : Ascent");
  });

  it("refuse un payload hors contrat plutôt que d'en donner les morceaux", () => {
    // Une ligne écrite par une version antérieure, ou à la main : mieux vaut
    // refuser le debrief que d'envoyer au modèle un match à moitié lu.
    expect(matchStatsFrom({ map: "Ascent" })).toBeNull();
    expect(matchStatsFrom(null)).toBeNull();
    expect(matchStatsFrom("Ascent 13-11")).toBeNull();
    expect(matchStatsFrom({ ...FULL, matchId: "" })).toBeNull();
  });
});
