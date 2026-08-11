/**
 * L'amorce déposée dans le fil du coach depuis la page d'un match (SPEC
 * §5 sexies, V4).
 *
 * Deux choses se vérifient, et elles tiennent au fait que le texte est relu par
 * un modèle **comme s'il venait du joueur** :
 *
 * 1. **la partie est nommée** — map, date, résultat — pour que le coach sache
 *    de laquelle on parle sans qu'on lui recopie l'analyse ;
 * 2. **la phrase reste grammaticale quand la source n'a rien donné**. Un résumé
 *    Valorant est intégralement nullable ; « Revenons sur ma partie sur , le
 *    (). » ne se rattrape pas côté modèle.
 */

import { describe, expect, it } from "vitest";
import type { MatchDetail } from "../data";
import { coachPrefillForMatch, matchLabel } from "./analysis-prefill";

const DETAIL: MatchDetail = {
  matchId: "m-1",
  playedAt: "2026-08-09T18:12:00.000Z",
  map: "Ascent",
  mode: "Competitive",
  team: "bleue",
  result: "defaite",
  roundsWon: 11,
  roundsLost: 13,
  scoreboard: [],
  rounds: [],
  sides: [],
};

/** Le fuseau du navigateur décide de l'heure : on ne teste que la date. */
function withoutTime(text: string): string {
  return text.replace(/\d{2}:\d{2}/u, "");
}

describe("matchLabel", () => {
  it("nomme la partie par ses trois repères", () => {
    const label = withoutTime(matchLabel(DETAIL));

    expect(label).toContain("sur Ascent");
    expect(label).toContain("août 2026");
    expect(label).toContain("Défaite 11-13");
  });

  it("tait le résultat plutôt que d'annoncer son ignorance au coach", () => {
    const label = matchLabel({ ...DETAIL, result: null, roundsWon: null, roundsLost: null });

    expect(label).not.toContain("inconnu");
    expect(label).toContain("sur Ascent");
  });

  it("tait un demi-score : « 11 » tout seul serait un chiffre de plus à interpréter", () => {
    const label = matchLabel({ ...DETAIL, roundsLost: null });

    expect(label).toContain("Défaite");
    expect(label).not.toContain("11");
  });

  it("reste grammatical quand la source n'a donné qu'une date", () => {
    const label = withoutTime(matchLabel({ ...DETAIL, map: null }));

    expect(label).toMatch(/^ma partie le \d/u);
    expect(label).not.toContain("sur ,");
  });

  it("se rabat sur une désignation neutre quand la source n'a rien donné", () => {
    const label = matchLabel({
      ...DETAIL,
      map: null,
      playedAt: null,
      result: null,
      roundsWon: null,
      roundsLost: null,
    });

    expect(label).toBe("la partie que je viens d'ouvrir");
  });
});

describe("coachPrefillForMatch", () => {
  it("nomme la partie puis pose une seule demande, ouverte", () => {
    const text = coachPrefillForMatch(DETAIL);

    expect(text).toContain("Revenons sur ma partie sur Ascent");
    expect(text).toContain("approfondir l'analyse");
    // Une seule question : deux enchaînées feraient un premier tour brouillon.
    expect(text.split("?")).toHaveLength(2);
  });

  it("tient très largement sous la borne d'un message de coach", () => {
    expect(coachPrefillForMatch(DETAIL).length).toBeLessThan(2000);
  });
});
