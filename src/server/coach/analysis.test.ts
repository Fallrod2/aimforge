/**
 * La police de la mini-analyse et sa relance (SPEC §5 sexies, V4).
 *
 * Ce qui compte ici n'est pas différent du chat — vide, trop long, scénario
 * inventé — mais l'enjeu l'est : une analyse acceptée est **mise en cache à
 * vie** (migration 0016). Un conseil silencieusement faux ne se corrigerait
 * jamais tout seul ; d'où le refus franc plutôt que le texte amputé.
 *
 * Le modèle est un port : ces tests ne touchent ni le réseau ni une clé d'API.
 */

import { describe, expect, it } from "vitest";
import { MATCH_ANALYSIS_MAX } from "../../shared/valorant-contract.js";
import type { ModelAnswer } from "../ai/port.js";
import type { ScenarioGroup } from "../shared/scenarios.js";
import { type AskAnalysis, generateMatchAnalysis, parseAnalysis } from "./analysis.js";
import type { AnalysisContext } from "./analysis-prompt.js";

const SCENARIOS: readonly ScenarioGroup[] = [
  { subcategory: "Dynamic", scenarios: ["VT Pasu Novice", "VT Popcorn Novice"] },
];

const ALLOWED = ["VT Pasu Novice", "VT Popcorn Novice"];

const CONTEXT: AnalysisContext = {
  detail: {
    matchId: "m-1",
    playedAt: null,
    map: "Ascent",
    mode: null,
    team: "bleue",
    result: "defaite",
    roundsWon: 11,
    roundsLost: 13,
    scoreboard: [],
    rounds: [],
    sides: [],
  },
  summary: null,
  profile: null,
  bench: { tiers: [], latestTier: null },
  scenarios: SCENARIOS,
};

const GOOD =
  "Défaite serrée 11-13 malgré 152 d'ADR. Tes entrées sont propres. À corriger : le replacement post-plant.";

/** Une réponse entière du modèle : le cas ordinaire. */
function said(text: string): ModelAnswer {
  return { text, truncated: false };
}

/** Une réponse coupée au plafond de jetons — lisible, et pourtant incomplète. */
function cut(text: string): ModelAnswer {
  return { text, truncated: true };
}

/** Un modèle qui rend les réponses données, dans l'ordre, et compte ses appels. */
function scripted(answers: readonly (string | ModelAnswer)[]): {
  ask: AskAnalysis;
  calls: () => number;
} {
  let calls = 0;

  return {
    ask: () => {
      const answer = answers[calls] ?? "";

      calls += 1;
      return Promise.resolve(typeof answer === "string" ? said(answer) : answer);
    },
    calls: () => calls,
  };
}

describe("parseAnalysis", () => {
  it("accepte une analyse courte et la débarrasse de ses blancs", () => {
    const parsed = parseAnalysis(said(`  ${GOOD}\n`), ALLOWED);

    expect(parsed).toEqual({ ok: true, analysis: GOOD });
  });

  it("refuse une réponse vide", () => {
    expect(parseAnalysis(said("   \n "), ALLOWED)).toEqual({
      ok: false,
      reason: "l'analyse est vide",
    });
  });

  it("refuse un debrief déguisé, et dit au modèle de combien il déborde", () => {
    const parsed = parseAnalysis(said("a".repeat(MATCH_ANALYSIS_MAX + 1)), ALLOWED);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain(`${MATCH_ANALYSIS_MAX + 1} caractères`);
    expect(parsed.reason).toContain("deux à quatre phrases");
  });

  it("accepte tout juste la borne : elle est celle de la colonne", () => {
    expect(parseAnalysis(said("a".repeat(MATCH_ANALYSIS_MAX)), ALLOWED).ok).toBe(true);
  });

  it("accepte un scénario du palier, cité au mot près", () => {
    expect(parseAnalysis(said("Trois runs de VT Pasu Novice."), ALLOWED).ok).toBe(true);
  });

  it("refuse un scénario d'un autre palier", () => {
    const parsed = parseAnalysis(said("Trois runs de VT Pasu Master."), ALLOWED);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain("Pasu Master");
  });

  /**
   * Le cas que le texte seul ne peut pas trahir : court, bien formé, scénarios
   * corrects — et pourtant amputé de sa fin. Sans le drapeau du port, cette
   * réponse passait la police et partait en cache à vie.
   */
  it("refuse une réponse coupée au plafond, même irréprochable par ailleurs", () => {
    const parsed = parseAnalysis(cut(GOOD), ALLOWED);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain("coupée");
  });
});

describe("generateMatchAnalysis", () => {
  it("rend l'analyse du premier coup quand elle est exploitable", async () => {
    const model = scripted([GOOD]);
    const result = await generateMatchAnalysis(model.ask, CONTEXT);

    expect(result).toEqual({ ok: true, analysis: GOOD, attempts: 1 });
    expect(model.calls()).toBe(1);
  });

  it("relance **une** fois, et rend la seconde réponse si elle passe", async () => {
    const model = scripted(["Fais du VT Pasu Master.", GOOD]);
    const result = await generateMatchAnalysis(model.ask, CONTEXT);

    expect(result).toEqual({ ok: true, analysis: GOOD, attempts: 2 });
    expect(model.calls()).toBe(2);
  });

  it("échoue franchement plutôt que d'enregistrer un conseil inapplicable", async () => {
    const model = scripted(["VT Pasu Master.", "Encore VT Pasu Master."]);
    const result = await generateMatchAnalysis(model.ask, CONTEXT);

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    // Deux appels, pas trois : la relance est unique, et l'échec est définitif.
    expect(model.calls()).toBe(2);
  });

  it("relance sur une sortie coupée, et garde la seconde si elle est entière", async () => {
    const model = scripted([cut(GOOD), GOOD]);
    const result = await generateMatchAnalysis(model.ask, CONTEXT);

    expect(result).toEqual({ ok: true, analysis: GOOD, attempts: 2 });
    expect(model.calls()).toBe(2);
  });

  it("échoue plutôt que de rendre un texte amputé, quand la relance est coupée aussi", async () => {
    const model = scripted([cut(GOOD), cut(GOOD)]);
    const result = await generateMatchAnalysis(model.ask, CONTEXT);

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    // Rien de « rattrapé » au passage : le texte tronqué ne ressort d'ici sous
    // aucune forme — c'est ce qui garantit qu'il n'est jamais mis en cache.
    expect(result).not.toHaveProperty("analysis");
  });

  it("contrôle contre la liste **montrée** au modèle, jamais contre une autre", async () => {
    // Un palier dont le catalogue ne contient pas « VT Pasu Novice » : la même
    // phrase qui passait plus haut doit être refusée ici.
    const other: AnalysisContext = {
      ...CONTEXT,
      scenarios: [{ subcategory: "Dynamic", scenarios: ["VT Pasu Master"] }],
    };
    const model = scripted(["Trois runs de VT Pasu Novice.", "Trois runs de VT Pasu Novice."]);
    const result = await generateMatchAnalysis(model.ask, other);

    expect(result.ok).toBe(false);
  });
});
