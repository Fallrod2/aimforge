import { describe, expect, it, vi } from "vitest";
import { CHAT_ANSWER_MAX } from "../../shared/coach-chat-contract";
import { scenarioCatalog, scenarioNames } from "../shared/scenarios";
import { generateChatAnswer, parseChatAnswer } from "./chat";
import type { ChatContext } from "./chat-prompt";

const ALLOWED = scenarioNames(scenarioCatalog("intermediate").groups);

const CONTEXT: ChatContext = {
  debrief: {
    date: "2026-08-09T19:00:00.000Z",
    resume: "Partie serrée.",
    points_forts: ["Entrées propres"],
    axes: [{ titre: "Retakes", detail: "Entrez groupés." }],
    focus: "Viseur à hauteur de tête.",
  },
  profile: null,
  bench: { tiers: [], latestTier: null },
  scenarios: scenarioCatalog("intermediate").groups,
  history: [],
  question: "Que faire pour l'axe 1 ?",
};

describe("parseChatAnswer", () => {
  it("accepte une réponse en texte simple et la détoure", () => {
    const parsed = parseChatAnswer("  Travaille tes retakes en deathmatch.\n", ALLOWED);

    expect(parsed.ok && parsed.answer).toBe("Travaille tes retakes en deathmatch.");
  });

  it("refuse une réponse vide", () => {
    expect(parseChatAnswer("   \n", ALLOWED)).toEqual({
      ok: false,
      reason: "la réponse est vide",
    });
  });

  it("refuse une réponse démesurée : la colonne a une borne, pas le modèle", () => {
    const parsed = parseChatAnswer("x".repeat(CHAT_ANSWER_MAX + 1), ALLOWED);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("beaucoup plus court");
    // La borne elle-même passe : elle est atteignable, pas interdite.
    expect(parseChatAnswer("x".repeat(CHAT_ANSWER_MAX), ALLOWED).ok).toBe(true);
  });

  it("accepte un scénario du palier, cité au mot près", () => {
    expect(parseChatAnswer("Fais 3 runs de VT Pasu Intermediate.", ALLOWED).ok).toBe(true);
  });

  it("refuse un scénario inventé, et le nomme au modèle", () => {
    const parsed = parseChatAnswer("Fais 3 runs de VT Reactive Tracking.", ALLOWED);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.reason).toContain("VT Reactive Tracking");
  });

  it("refuse un scénario emprunté à un autre palier", () => {
    // « VT Pasu Novice » existe dans le jeu, mais pas dans le palier mesuré :
    // le conseil enverrait le joueur dans une liste qu'il n'a pas ouverte.
    expect(parseChatAnswer("Joue VT Pasu Novice.", ALLOWED).ok).toBe(false);
  });
});

describe("generateChatAnswer", () => {
  it("livre la première réponse quand elle est exploitable", async () => {
    const ask = vi.fn().mockResolvedValue("Reste sur des retakes groupés.");
    const result = await generateChatAnswer(ask, CONTEXT);

    expect(result).toEqual({
      ok: true,
      answer: "Reste sur des retakes groupés.",
      attempts: 1,
    });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("relance une fois quand un scénario est inventé, et livre la correction", async () => {
    const ask = vi
      .fn()
      .mockResolvedValueOnce("Fais 3 runs de VT PraFlick Deluxe.")
      .mockResolvedValueOnce("Fais 3 runs de VT Pasu Intermediate.");
    const result = await generateChatAnswer(ask, CONTEXT);

    expect(result.ok && result.attempts).toBe(2);
    expect(result.ok && result.answer).toContain("VT Pasu Intermediate");
  });

  it("ne relance qu'une fois : au-delà, c'est le prompt ou le modèle", async () => {
    const ask = vi.fn().mockResolvedValue("Fais 3 runs de VT Reactive Tracking.");
    const result = await generateChatAnswer(ask, CONTEXT);

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("contrôle la réponse contre la liste **montrée**, pas contre une autre", async () => {
    // La liste appliquée est dérivée du contexte : si on la recalculait à côté,
    // le modèle pourrait être relancé sur des noms qu'on lui a nous-mêmes donnés.
    const novice: ChatContext = { ...CONTEXT, scenarios: scenarioCatalog("novice").groups };
    const ask = vi.fn().mockResolvedValue("Joue VT Pasu Novice.");

    expect((await generateChatAnswer(ask, novice)).ok).toBe(true);
    expect((await generateChatAnswer(ask, CONTEXT)).ok).toBe(false);
  });
});
