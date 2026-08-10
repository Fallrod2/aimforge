import { describe, expect, it, vi } from "vitest";
import { DEBRIEF_SUGGESTION_MARKER } from "../../shared/coach-thread-contract";
import { scenarioCatalog } from "../shared/scenarios";
import type { AskModel } from "./generate";
import { generateThreadAnswer, parseThreadAnswer, stripDebriefSuggestion } from "./thread";
import type { ThreadContext } from "./thread-prompt";

const CATALOG = scenarioCatalog("intermediate");

const ALLOWED = [...CATALOG.names];

function context(): ThreadContext {
  return {
    profile: null,
    bench: null,
    scenarios: CATALOG.groups,
    matches: [],
    debriefs: [],
    history: [],
    question: "Que travailler aujourd'hui ?",
    hasUndebriefedMatch: true,
  };
}

/** Un modèle qui rend les réponses données, dans l'ordre. */
function asking(...answers: readonly string[]): AskModel {
  const queue = [...answers];

  return vi.fn(() => Promise.resolve(queue.shift() ?? ""));
}

const GOOD = "Fais trois runs de VT Pasu Intermediate, puis un deathmatch de dix minutes.";

describe("stripDebriefSuggestion", () => {
  it("laisse le texte intact quand il n'y a pas de marqueur", () => {
    expect(stripDebriefSuggestion(GOOD)).toEqual({ text: GOOD, suggested: false });
  });

  it("retire la ligne du marqueur en entier : elle n'est pas destinée à être lue", () => {
    const raw = `${GOOD}\n${DEBRIEF_SUGGESTION_MARKER}`;
    const stripped = stripDebriefSuggestion(raw);

    expect(stripped.suggested).toBe(true);
    expect(stripped.text).toBe(GOOD);
    expect(stripped.text).not.toContain("[[");
  });

  it("retire le marqueur sans avaler le texte qui partage sa ligne", () => {
    const stripped = stripDebriefSuggestion(`Veux-tu un debrief ? ${DEBRIEF_SUGGESTION_MARKER}`);

    expect(stripped.text).toBe("Veux-tu un debrief ?");
    expect(stripped.suggested).toBe(true);
  });

  it("retire toutes les occurrences, où qu'elles soient", () => {
    const stripped = stripDebriefSuggestion(
      `${DEBRIEF_SUGGESTION_MARKER}\nMilieu\n${DEBRIEF_SUGGESTION_MARKER}`,
    );

    expect(stripped.text).toBe("Milieu");
  });
});

describe("parseThreadAnswer", () => {
  it("accepte une réponse propre et ne signale aucune suggestion", () => {
    expect(parseThreadAnswer(GOOD, ALLOWED)).toEqual({
      ok: true,
      answer: GOOD,
      suggestsDebrief: false,
    });
  });

  it("rend la suggestion à part, jamais dans le texte enregistré", () => {
    const parsed = parseThreadAnswer(`${GOOD}\n${DEBRIEF_SUGGESTION_MARKER}\n`, ALLOWED);

    expect(parsed).toEqual({ ok: true, answer: GOOD, suggestsDebrief: true });
  });

  it("refuse une réponse qui ne serait que le marqueur : c'est une réponse vide", () => {
    const parsed = parseThreadAnswer(DEBRIEF_SUGGESTION_MARKER, ALLOWED);

    expect(parsed).toEqual({ ok: false, reason: "la réponse est vide" });
  });

  it("refuse un scénario inventé — la police du fil est celle du reste du coach", () => {
    const parsed = parseThreadAnswer("Enchaîne des runs de VT Pasu Master.", ALLOWED);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("VT Pasu Master");
  });

  it("refuse un scénario d'un autre palier, même s'il existe dans le jeu", () => {
    const parsed = parseThreadAnswer("Travaille VT Pasu Novice.", ALLOWED);

    expect(parsed.ok).toBe(false);
  });

  it("laisse passer un conseil sans nom de scénario", () => {
    const parsed = parseThreadAnswer("Dix minutes de deathmatch, viseur à hauteur de tête.", [
      ...ALLOWED,
    ]);

    expect(parsed.ok).toBe(true);
  });
});

describe("generateThreadAnswer", () => {
  it("rend la réponse du premier coup quand elle est exploitable", async () => {
    const result = await generateThreadAnswer(asking(GOOD), context());

    expect(result).toEqual({ ok: true, answer: GOOD, suggestsDebrief: false, attempts: 1 });
  });

  it("relance une seule fois, et garde la suggestion de la relance", async () => {
    const ask = asking("VT Pasu Master", `${GOOD}\n${DEBRIEF_SUGGESTION_MARKER}`);
    const result = await generateThreadAnswer(ask, context());

    expect(result).toEqual({ ok: true, answer: GOOD, suggestsDebrief: true, attempts: 2 });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("abandonne après la relance ratée, sans troisième tentative", async () => {
    const ask = asking("VT Pasu Master", "VT Popcorn Master");
    const result = await generateThreadAnswer(ask, context());

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(ask).toHaveBeenCalledTimes(2);
  });
});
