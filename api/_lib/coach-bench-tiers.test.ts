/**
 * Le chargeur multi-paliers du bench, et ce qu'il change dans le prompt.
 *
 * Le cas rejoué ici est celui qui a été constaté en production : deux paliers
 * terminés (Novice, Intermediate) et une passe Advanced à peine commencée, la
 * plus récente. La lecture d'alors ne rapportait que **la** dernière passe,
 * toutes catégories confondues : le coach, honnêtement, répondait qu'il ne
 * voyait qu'Advanced et que les deux paliers terminés n'existaient pas.
 *
 * Ce que ce test vérifie n'est donc pas une requête, c'est le bout de chaîne
 * qui compte : des lignes en base jusqu'au texte scellé que le modèle lit.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BENCHMARK_ID, listScenarios } from "../../src/lib/energy/index.js";
import { buildAnalysisUserMessage } from "../../src/server/coach/analysis-prompt.js";
import { buildChatMessages } from "../../src/server/coach/chat-prompt.js";
import { buildCoachUserMessage } from "../../src/server/coach/prompt.js";
import { buildThreadMessages } from "../../src/server/coach/thread-prompt.js";
import { scenarioCatalog } from "../../src/server/shared/scenarios.js";
import type { MatchDetail } from "../../src/shared/valorant-contract.js";
import { type CoachUserClient, DEFAULT_TIER, loadBenchTiers } from "./coach-context.js";

const USER = "utilisateur-1";

/** Une passe telle que `bench_runs` la rend. */
interface RunRow {
  readonly id: number;
  readonly date: string;
  readonly tier: string;
  readonly overall: number;
  readonly rank: string | null;
  readonly complete: boolean;
  /** La colonne du benchmark s'appelle encore `season` (migration 0017). */
  readonly season: string;
}

const NOVICE: RunRow = {
  id: 1,
  date: "2026-06-12T18:30:00.000Z",
  tier: "novice",
  overall: 812.4,
  rank: "Gold",
  complete: true,
  season: DEFAULT_BENCHMARK_ID,
};

const INTERMEDIATE: RunRow = {
  id: 2,
  date: "2026-07-20T18:30:00.000Z",
  tier: "intermediate",
  overall: 612.3,
  rank: "Diamond",
  complete: false,
  season: DEFAULT_BENCHMARK_ID,
};

/** La passe la plus récente, et la seule qui remontait avant ce chargeur. */
const ADVANCED: RunRow = {
  id: 3,
  date: "2026-08-09T18:30:00.000Z",
  tier: "advanced",
  overall: 0,
  rank: null,
  complete: false,
  season: DEFAULT_BENCHMARK_ID,
};

/** Les 18 scénarios d'un palier, ou les `count` premiers. */
function scoresOf(tier: "novice" | "intermediate" | "advanced", count = 18) {
  return listScenarios(tier)
    .slice(0, count)
    .map((scenario) => ({ scenario: scenario.name, score: scenario.thresholds.at(-1) ?? 1 }));
}

interface Fixture {
  readonly runs: readonly RunRow[];
  readonly scores: Readonly<Record<number, readonly { scenario: string; score: number }[]>>;
  /** Les paliers dont la lecture échoue, pour prouver la dégradation. */
  readonly failing?: readonly string[];
}

/**
 * Un client Supabase réduit à ce que le chargeur lui demande : le filtre par
 * palier, le tri, la limite. Il rend les lignes de la fixture, jamais autre
 * chose — c'est le chargeur qu'on teste, pas PostgREST.
 */
function fakeClient(fixture: Fixture): CoachUserClient {
  const client = {
    from(table: string) {
      const filters = new Map<string, unknown>();
      const chain = {
        select() {
          return chain;
        },
        eq(column: string, value: unknown) {
          filters.set(column, value);
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle() {
          const tier = String(filters.get("tier"));

          if (fixture.failing?.includes(tier) === true) {
            return Promise.resolve({ data: null, error: { message: "lecture refusée" } });
          }
          const rows = fixture.runs
            .filter((row) => row.tier === tier && filters.get("user_id") === USER)
            // Le chargeur demande la plus récente : la fixture l'ordonne comme
            // la base le ferait.
            .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        // biome-ignore lint/suspicious/noThenProperty: imite le constructeur de requête de PostgREST, qui est une promesse.
        then<A>(onfulfilled: (value: { data: unknown; error: unknown }) => A): Promise<A> {
          const runId = Number(filters.get("run_id"));

          return Promise.resolve(
            onfulfilled({ data: fixture.scores[runId] ?? [], error: null }),
          ) as Promise<A>;
        },
      };

      return table === "bench_runs" || table === "scenario_scores"
        ? chain
        : { select: () => chain };
    },
  };

  return client as unknown as CoachUserClient;
}

/** Une partie réduite au strict nécessaire : le sujet de la mini-analyse. */
const MATCH_DETAIL: MatchDetail = {
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

/** Les trois paliers du bug constaté : deux terminés, un à peine entamé. */
const REAL_CASE: Fixture = {
  runs: [NOVICE, INTERMEDIATE, ADVANCED],
  scores: {
    1: scoresOf("novice"),
    2: scoresOf("intermediate"),
    3: scoresOf("advanced", 4),
  },
};

describe("loadBenchTiers", () => {
  it("rend la dernière passe de chaque palier, du plus bas au plus haut", async () => {
    const bench = await loadBenchTiers(fakeClient(REAL_CASE), USER);

    expect(bench.tiers.map((tier) => tier.tier)).toEqual(["novice", "intermediate", "advanced"]);
    expect(bench.latestTier).toBe("advanced");
  });

  it("compte la complétude de chaque passe, et garde le rang des paliers terminés", async () => {
    const bench = await loadBenchTiers(fakeClient(REAL_CASE), USER);
    const [novice, intermediate, advanced] = bench.tiers;

    expect(novice?.filled).toBe(18);
    expect(novice?.rank).toBe("Gold");
    expect(novice?.complete).toBe(true);
    expect(intermediate?.filled).toBe(18);
    expect(advanced?.filled).toBe(4);
    expect(advanced?.total).toBe(18);
    expect(advanced?.overall).toBe(0);
  });

  it("garde le benchmark de chaque passe", async () => {
    const bench = await loadBenchTiers(fakeClient(REAL_CASE), USER);

    expect(bench.tiers.map((tier) => tier.benchmarkId)).toEqual([
      DEFAULT_BENCHMARK_ID,
      DEFAULT_BENCHMARK_ID,
      DEFAULT_BENCHMARK_ID,
    ]);
  });

  it("tient sur un seul palier mesuré", async () => {
    const bench = await loadBenchTiers(
      fakeClient({ runs: [INTERMEDIATE], scores: { 2: scoresOf("intermediate") } }),
      USER,
    );

    expect(bench.tiers).toHaveLength(1);
    expect(bench.latestTier).toBe("intermediate");
  });

  it("rend une liste vide quand le joueur n'a aucune passe", async () => {
    const bench = await loadBenchTiers(fakeClient({ runs: [], scores: {} }), USER);

    expect(bench.tiers).toEqual([]);
    expect(bench.latestTier).toBeNull();
  });

  it("écarte une passe dont le benchmark est inconnu du registre", async () => {
    const bench = await loadBenchTiers(
      fakeClient({
        runs: [{ ...NOVICE, season: "voltaic-s9" }, INTERMEDIATE],
        scores: { 2: scoresOf("intermediate") },
      }),
      USER,
    );

    expect(bench.tiers.map((tier) => tier.tier)).toEqual(["intermediate"]);
  });

  it("dégrade sans annuler : une lecture en échec ne fait pas disparaître les autres paliers", async () => {
    const bench = await loadBenchTiers(fakeClient({ ...REAL_CASE, failing: ["advanced"] }), USER);

    expect(bench.tiers.map((tier) => tier.tier)).toEqual(["novice", "intermediate"]);
    expect(bench.latestTier).toBe("intermediate");
  });
});

describe("le prompt servi au coach", () => {
  it("porte les trois paliers, leur complétude et le rang du palier terminé", async () => {
    const bench = await loadBenchTiers(fakeClient(REAL_CASE), USER);
    const message = buildCoachUserMessage({
      stats: "Ascent · Jett · 18/14/5",
      profile: null,
      bench,
      scenarios: scenarioCatalog(bench.latestTier ?? DEFAULT_TIER).groups,
    });

    expect(message).toContain("Palier Novice");
    expect(message).toContain("Palier Intermediate");
    expect(message).toContain("Palier Advanced");
    expect(message).toContain("18/18 scénarios renseignés");
    expect(message).toContain("4/18 scénarios renseignés");
    // Le palier terminé garde son rang : c'est la réponse à « vérifie mon bench ».
    expect(message).toContain("rang Gold");
    expect(message).toContain("rang Diamond");
    // Et la liste de scénarios reste celle de la passe la plus récente.
    expect(message).toContain("VT Pasu Advanced");
  });

  it("porte les trois paliers dans le fil, où la question a été posée", async () => {
    const bench = await loadBenchTiers(fakeClient(REAL_CASE), USER);
    const content =
      buildThreadMessages({
        profile: null,
        bench,
        scenarios: scenarioCatalog(bench.latestTier ?? DEFAULT_TIER).groups,
        matches: [],
        debriefs: [],
        history: [],
        question: "vérifie bien mon bench, j'ai tous les résultats en intermédiaire et novice",
        hasUndebriefedMatch: false,
      })[0]?.content ?? "";

    expect(content).toContain("Palier Novice");
    expect(content).toContain("Palier Intermediate");
    expect(content).toContain("Palier Advanced");
    expect(content).toContain("rang Gold");
  });

  it("porte les trois paliers dans le chat par debrief", async () => {
    const bench = await loadBenchTiers(fakeClient(REAL_CASE), USER);
    const content =
      buildChatMessages({
        debrief: {
          date: "2026-08-09T19:00:00.000Z",
          resume: "Partie serrée, perdue sur les retakes.",
          points_forts: ["Entrées propres sur A"],
          axes: [{ titre: "Retakes", detail: "Entrez groupés après la pose." }],
          focus: "Viseur à hauteur de tête.",
        },
        profile: null,
        bench,
        scenarios: scenarioCatalog(bench.latestTier ?? DEFAULT_TIER).groups,
        history: [],
        question: "où en est mon bench ?",
      })[0]?.content ?? "";

    expect(content).toContain("Palier Novice");
    expect(content).toContain("Palier Intermediate");
    expect(content).toContain("Palier Advanced");
    expect(content).toContain("18/18 scénarios renseignés");
    expect(content).toContain("4/18 scénarios renseignés");
    expect(content).toContain("rang Gold");
    // La liste de scénarios reste celle de la passe la plus récente.
    expect(content).toContain("VT Pasu Advanced");
  });

  it("porte les trois paliers dans la mini-analyse par match", async () => {
    const bench = await loadBenchTiers(fakeClient(REAL_CASE), USER);
    const message = buildAnalysisUserMessage({
      detail: MATCH_DETAIL,
      summary: null,
      profile: null,
      bench,
      scenarios: scenarioCatalog(bench.latestTier ?? DEFAULT_TIER).groups,
    });

    expect(message).toContain("Palier Novice");
    expect(message).toContain("Palier Intermediate");
    expect(message).toContain("Palier Advanced");
    expect(message).toContain("18/18 scénarios renseignés");
    expect(message).toContain("4/18 scénarios renseignés");
    expect(message).toContain("rang Gold");
    expect(message).toContain("VT Pasu Advanced");
  });
});
