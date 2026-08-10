/**
 * Le modèle est remplacé par un faux : c'est la seule façon de vérifier la
 * relance corrective, dont l'intérêt est justement le cas qu'on ne sait pas
 * provoquer sur un vrai modèle (« la première réponse invente un scénario »).
 */

import { describe, expect, it } from "vitest";
import { scenarioCatalog } from "../shared/scenarios";
import { type AskModel, generateRoutine } from "./generate";
import type { RoutineContext, RoutineMessage } from "./prompt";

const CATALOG = scenarioCatalog("novice");
const ALLOWED = CATALOG.names;

const ROUTINE = {
  titre: "Séance 45 min",
  duree_totale: 45,
  blocs: [
    {
      nom: "Travail ciblé",
      duree: 45,
      items: [{ texte: "VT Pasu Novice", detail: "5 runs, viseur haut." }],
    },
  ],
  objectif_game: "Un duel gagné par round sur l'entrée.",
  conseil: "Coupe le chat vocal.",
};

const JSON_TEXT = JSON.stringify(ROUTINE);

const INVENTED = JSON.stringify({
  ...ROUTINE,
  blocs: [
    {
      nom: "Travail ciblé",
      duree: 45,
      items: [{ texte: "VT Tile Frenzy Deluxe", detail: "5 runs." }],
    },
  ],
});

const CONTEXT: RoutineContext = {
  dureeMinutes: 45,
  focus: null,
  bench: null,
  debriefs: [],
  ingame: null,
  scenarios: CATALOG.groups,
};

/** Le même contexte, mais avec des chiffres à citer (SPEC §5 sexies, V5). */
const CONTEXT_WITH_DATA: RoutineContext = {
  ...CONTEXT,
  ingame: {
    windowDays: 30,
    matches: 12,
    winrate: null,
    headshotPercent: 23,
    adr: null,
    kd: null,
    worstMaps: [],
  },
};

const CITED = JSON.stringify({
  ...ROUTINE,
  conseil: "Coupe le chat vocal, ton [HS% 23] le mérite.",
});

const WRONG_CITATION = JSON.stringify({
  ...ROUTINE,
  conseil: "Coupe le chat vocal, ton [HS% 41] le mérite.",
});

/** Un faux modèle qui déroule des réponses préparées et note ce qu'on lui envoie. */
function fakeModel(answers: readonly string[]): {
  readonly ask: AskModel;
  readonly calls: (readonly RoutineMessage[])[];
} {
  const calls: (readonly RoutineMessage[])[] = [];
  let index = 0;

  return {
    calls,
    ask: async (messages) => {
      calls.push(messages);
      const answer = answers[index] ?? "";

      index += 1;
      return answer;
    },
  };
}

describe("generateRoutine", () => {
  it("s'arrête au premier appel quand la réponse est conforme", async () => {
    const model = fakeModel([JSON_TEXT]);
    const result = await generateRoutine(model.ask, CONTEXT, ALLOWED);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(model.calls).toHaveLength(1);
  });

  it("relance une fois quand la première réponse est hors format, et garde la seconde", async () => {
    const model = fakeModel(["Voici ta séance en texte libre.", JSON_TEXT]);
    const result = await generateRoutine(model.ask, CONTEXT, ALLOWED);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.ok && result.routine.titre).toBe("Séance 45 min");
  });

  it("relance quand la routine invente un scénario, en le nommant au modèle", async () => {
    const model = fakeModel([INVENTED, JSON_TEXT]);
    const result = await generateRoutine(model.ask, CONTEXT, ALLOWED);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);

    const correction = model.calls[1];

    expect(correction?.map((entry) => entry.role)).toEqual(["user", "assistant", "user"]);
    expect(correction?.[1]?.content).toBe(INVENTED);
    expect(correction?.[2]?.content).toContain("VT Tile Frenzy Deluxe");
  });

  it("ne relance qu'une fois : deux scénarios inventés et on rend la main", async () => {
    const model = fakeModel([INVENTED, INVENTED, JSON_TEXT]);
    const result = await generateRoutine(model.ask, CONTEXT, ALLOWED);

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(model.calls).toHaveLength(2);
    expect(result.ok || result.reason).toContain("n'existent pas dans le palier");
  });

  it("relance quand la routine cite un chiffre faux, en le nommant au modèle", async () => {
    const model = fakeModel([WRONG_CITATION, CITED]);
    const result = await generateRoutine(model.ask, CONTEXT_WITH_DATA, ALLOWED);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(model.calls[1]?.[2]?.content).toContain("[HS% 41]");
    // Le marqueur vérifié ne survit pas dans le texte : il devient une source.
    expect(result.ok && result.routine.conseil).toBe("Coupe le chat vocal, ton le mérite.");
    expect(result.ok && result.sources).toEqual([
      { label: "Tirs à la tête (30 derniers jours)", value: "23 %" },
    ]);
  });

  it("ne relance qu'une fois sur une citation fausse non plus", async () => {
    const model = fakeModel([WRONG_CITATION, WRONG_CITATION, CITED]);
    const result = await generateRoutine(model.ask, CONTEXT_WITH_DATA, ALLOWED);

    expect(result.ok).toBe(false);
    expect(model.calls).toHaveLength(2);
    expect(result.ok || result.reason).toContain("chiffre faux");
  });

  it("laisse remonter une panne du modèle plutôt que de la déguiser en routine", async () => {
    const boom: AskModel = async () => {
      throw new Error("réseau injoignable");
    };

    await expect(generateRoutine(boom, CONTEXT, ALLOWED)).rejects.toThrow("réseau injoignable");
  });
});
