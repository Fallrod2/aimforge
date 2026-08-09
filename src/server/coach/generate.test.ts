/**
 * Le modèle est remplacé par un faux : c'est la seule façon de vérifier la
 * relance corrective, dont l'intérêt est justement le cas qu'on ne sait pas
 * provoquer sur un vrai modèle (« la première réponse est mauvaise »).
 */

import { describe, expect, it } from "vitest";
import { scenarioCatalog } from "../shared/scenarios";
import { type AskModel, generateDebrief, textOf } from "./generate";
import type { CoachContext, CoachMessage } from "./prompt";

const DEBRIEF = {
  resume: "Partie serrée, perdue sur les retakes.",
  points_forts: ["Entrées propres sur A"],
  axes: [{ titre: "Retakes", detail: "Entrez groupés après la pose." }],
  focus: "Viseur à hauteur de tête.",
};

const JSON_TEXT = JSON.stringify(DEBRIEF);

const CONTEXT: CoachContext = {
  stats: "Ascent 13-11",
  profile: null,
  bench: null,
  // Sans bench, le palier du joueur est inconnu : c'est la liste Novice qui
  // fait foi, exactement comme dans `api/coach.ts`.
  scenarios: scenarioCatalog("novice").groups,
};

/** Un debrief conforme qui cite un scénario inexistant. */
function invented(name: string): string {
  return JSON.stringify({
    ...DEBRIEF,
    axes: [{ titre: "Tracking", detail: `Fais 3 runs de ${name}.` }],
  });
}

/** Un faux modèle qui déroule des réponses préparées et note ce qu'on lui envoie. */
function fakeModel(answers: readonly string[]): {
  readonly ask: AskModel;
  readonly calls: (readonly CoachMessage[])[];
} {
  const calls: (readonly CoachMessage[])[] = [];
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

describe("textOf", () => {
  it("recolle les blocs de texte", () => {
    expect(
      textOf([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ]),
    ).toBe("a\nb");
  });

  it("ignore les blocs qui ne sont pas du texte", () => {
    expect(
      textOf([{ type: "thinking" }, { type: "text", text: "  utile  " }, { type: "tool_use" }]),
    ).toBe("utile");
  });

  it("rend une chaîne vide sur une réponse sans texte", () => {
    expect(textOf([])).toBe("");
  });
});

describe("generateDebrief", () => {
  it("s'arrête au premier appel quand la réponse est conforme", async () => {
    const model = fakeModel([JSON_TEXT]);
    const result = await generateDebrief(model.ask, CONTEXT);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(model.calls).toHaveLength(1);
  });

  it("relance une fois quand la première réponse est hors format, et garde la seconde", async () => {
    const model = fakeModel(["Voici ton debrief en texte libre.", JSON_TEXT]);
    const result = await generateDebrief(model.ask, CONTEXT);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.ok && result.debrief.focus).toBe("Viseur à hauteur de tête.");
  });

  it("montre au modèle sa sortie fautive et la raison du refus", async () => {
    const model = fakeModel(["pas du JSON", JSON_TEXT]);

    await generateDebrief(model.ask, CONTEXT);

    const correction = model.calls[1];

    expect(correction?.map((entry) => entry.role)).toEqual(["user", "assistant", "user"]);
    expect(correction?.[1]?.content).toBe("pas du JSON");
    expect(correction?.[2]?.content).toContain("aucun objet JSON");
  });

  it("ne relance qu'une fois : deux échecs et on rend la main", async () => {
    const model = fakeModel(["non", "toujours non", JSON_TEXT]);
    const result = await generateDebrief(model.ask, CONTEXT);

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(model.calls).toHaveLength(2);
    expect(result.ok || result.reason).toContain("aucun objet JSON");
  });

  it("relance aussi sur un JSON valide mais hors contrat", async () => {
    const model = fakeModel([JSON.stringify({ resume: "seul" }), JSON_TEXT]);
    const result = await generateDebrief(model.ask, CONTEXT);

    expect(result.ok).toBe(true);
    expect(model.calls[1]?.[2]?.content).toContain("schéma");
  });

  it("relance sur un scénario inventé, et garde la seconde réponse", async () => {
    const model = fakeModel([invented("VT Reactive Tracking"), JSON_TEXT]);
    const result = await generateDebrief(model.ask, CONTEXT);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    // La relance nomme le fautif : le modèle sait quoi corriger.
    expect(model.calls[1]?.[2]?.content).toContain("« VT Reactive Tracking »");
  });

  it("rend la main après deux inventions : l'appelant en fera un 502", async () => {
    const model = fakeModel([invented("VT Reactive Tracking"), invented("VT Close Range Strafe")]);
    const result = await generateDebrief(model.ask, CONTEXT);

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(model.calls).toHaveLength(2);
    expect(result.ok || result.reason).toContain("« VT Close Range Strafe »");
  });

  it("accepte un scénario du palier montré au modèle", async () => {
    const model = fakeModel([invented("VT Pasu Novice")]);
    const result = await generateDebrief(model.ask, CONTEXT);

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it("contrôle exactement la liste qu'il a montrée, pas une autre", async () => {
    // Le palier Intermediate est montré : « VT Pasu Intermediate » est légitime,
    // et « VT Pasu Novice » — d'un autre palier — ne l'est plus.
    const context: CoachContext = { ...CONTEXT, scenarios: scenarioCatalog("intermediate").groups };
    const model = fakeModel([invented("VT Pasu Intermediate")]);

    expect((await generateDebrief(model.ask, context)).ok).toBe(true);
    expect((await generateDebrief(fakeModel([invented("VT Pasu Novice")]).ask, context)).ok).toBe(
      false,
    );
  });

  it("laisse remonter une panne du modèle plutôt que de la déguiser en debrief", async () => {
    const boom: AskModel = async () => {
      throw new Error("réseau injoignable");
    };

    await expect(generateDebrief(boom, CONTEXT)).rejects.toThrow("réseau injoignable");
  });
});
