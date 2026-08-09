/**
 * L'écriture d'une passe sans transaction.
 *
 * Le serveur Hono écrivait la passe et ses 18 scores dans une transaction
 * SQLite : soit tout, soit rien. Le client Supabase n'a pas cet outil — deux
 * requêtes, aucun lien entre elles. Ces tests fixent le comportement de
 * remplacement : la passe orpheline est supprimée, et l'erreur remonte.
 *
 * Le magasin est un faux : pas de réseau, pas de DOM, pas de Supabase importé.
 */

import { describe, expect, it } from "vitest";
import { computeBenchRun } from "../../lib/energy";
import { anchorEnergy, scoresAtAnchor } from "../../lib/energy/fixtures";
import { type BenchRunStore, saveBenchRunTo } from "./bench-runs";
import { DataError } from "./errors";
import type { BenchRunRow, ScenarioScoreRow } from "./mapping";

interface Recorder {
  readonly store: BenchRunStore;
  readonly calls: string[];
  readonly inserted: ScenarioScoreRow[];
  /** La provenance telle qu'elle est arrivée au magasin. */
  readonly sources: string[];
}

interface FakeOptions {
  readonly failScores?: boolean;
  readonly failCompensation?: boolean;
}

function fakeStore({ failScores = false, failCompensation = false }: FakeOptions = {}): Recorder {
  const calls: string[] = [];
  const inserted: ScenarioScoreRow[] = [];
  const sources: string[] = [];
  let nextId = 41;

  const store: BenchRunStore = {
    async insertRun(run) {
      calls.push("insertRun");
      sources.push(run.source);
      nextId += 1;

      const row: BenchRunRow = {
        id: nextId,
        date: run.date ?? "2026-03-01T12:00:00+00:00",
        tier: run.tier,
        overall: run.overall,
        rank: run.rank,
        complete: run.complete,
        source: run.source,
      };

      return row;
    },
    async insertScores(_runId, scores) {
      calls.push("insertScores");
      if (failScores) throw new Error("insert scenario_scores refusé");
      inserted.push(...scores);
    },
    async deleteRun(runId) {
      calls.push(`deleteRun:${runId}`);
      if (failCompensation) throw new Error("delete refusé");
    },
  };

  return { store, calls, inserted, sources };
}

const novice = scoresAtAnchor("novice", "Gold");

describe("saveBenchRunTo — chemin nominal", () => {
  it("écrit la passe puis ses scores, dans cet ordre", async () => {
    const { store, calls, inserted } = fakeStore();

    await saveBenchRunTo(store, { tier: "novice", scores: novice });

    expect(calls).toEqual(["insertRun", "insertScores"]);
    expect(inserted).toHaveLength(18);
  });

  it("calcule overall, rang et « Complete » avant l'insertion", async () => {
    const { store } = fakeStore();
    const detail = await saveBenchRunTo(store, { tier: "novice", scores: novice });

    expect(detail.overall).toBeCloseTo(anchorEnergy("novice", "Gold"), 5);
    expect(detail.rank).toBe("Gold");
    expect(detail.complete).toBe(true);
    expect(detail.scores).toHaveLength(18);
    expect(detail.subcategories).toHaveLength(9);
  });

  it("écrit exactement les énergies de la lib pure, sans les recalculer ailleurs", async () => {
    const { store, inserted } = fakeStore();

    await saveBenchRunTo(store, { tier: "novice", scores: novice });

    expect([...inserted].sort((a, b) => a.scenario.localeCompare(b.scenario))).toEqual(
      [...computeBenchRun("novice", novice).scores].sort((a, b) =>
        a.scenario.localeCompare(b.scenario),
      ),
    );
  });

  it("normalise la date imposée en ISO UTC", async () => {
    const { store } = fakeStore();
    const detail = await saveBenchRunTo(store, {
      tier: "novice",
      scores: novice,
      date: "2026-03-01T14:00:00+02:00",
    });

    expect(detail.date).toBe("2026-03-01T12:00:00.000Z");
  });

  it("laisse la base dater la passe quand aucune date n'est imposée", async () => {
    let received: string | undefined = "sentinelle";
    const store: BenchRunStore = {
      async insertRun(run) {
        received = run.date;
        return {
          id: 1,
          date: "2026-03-01T12:00:00+00:00",
          tier: run.tier,
          overall: run.overall,
          rank: run.rank,
          complete: run.complete,
          source: run.source,
        };
      },
      async insertScores() {},
      async deleteRun() {},
    };

    await saveBenchRunTo(store, { tier: "novice", scores: novice });
    expect(received).toBeUndefined();
  });

  it("marque « saisie manuelle » par défaut", async () => {
    const { store, sources } = fakeStore();
    const detail = await saveBenchRunTo(store, { tier: "novice", scores: novice });

    expect(sources).toEqual(["manual"]);
    expect(detail.source).toBe("manual");
  });

  it("porte la provenance jusqu'à l'écriture quand la passe vient d'un import", async () => {
    const { store, sources } = fakeStore();
    const detail = await saveBenchRunTo(store, {
      tier: "novice",
      scores: novice,
      source: "kovaaks",
    });

    expect(sources).toEqual(["kovaaks"]);
    expect(detail.source).toBe("kovaaks");
  });
});

describe("saveBenchRunTo — saisie refusée avant toute écriture", () => {
  it("refuse un scénario qui n'appartient pas au palier", async () => {
    const { store, calls } = fakeStore();

    await expect(
      saveBenchRunTo(store, { tier: "novice", scores: { "VT Pasu Advanced": 500 } }),
    ).rejects.toThrow(DataError);
    expect(calls).toEqual([]);
  });

  it("refuse une passe sans aucun score", async () => {
    const { store, calls } = fakeStore();

    await expect(saveBenchRunTo(store, { tier: "novice", scores: {} })).rejects.toThrow(
      /Aucun score/,
    );
    expect(calls).toEqual([]);
  });
});

describe("saveBenchRunTo — compensation", () => {
  it("supprime la passe orpheline quand les scores échouent", async () => {
    const { store, calls } = fakeStore({ failScores: true });

    await expect(saveBenchRunTo(store, { tier: "novice", scores: novice })).rejects.toThrow(
      DataError,
    );
    expect(calls).toEqual(["insertRun", "insertScores", "deleteRun:42"]);
  });

  it("remonte une erreur qui dit que rien n'a été gardé", async () => {
    const { store } = fakeStore({ failScores: true });

    await expect(saveBenchRunTo(store, { tier: "novice", scores: novice })).rejects.toThrow(
      /Rien n'a été gardé/,
    );
  });

  it("dit quelle passe est restée quand la compensation échoue elle aussi", async () => {
    const { store } = fakeStore({ failScores: true, failCompensation: true });

    await expect(saveBenchRunTo(store, { tier: "novice", scores: novice })).rejects.toThrow(
      /La passe 42 n'a pas pu être annulée/,
    );
  });

  it("garde le motif précis quand l'échec est déjà une DataError", async () => {
    const store: BenchRunStore = {
      async insertRun(run) {
        return {
          id: 7,
          date: "2026-03-01T12:00:00+00:00",
          tier: run.tier,
          overall: run.overall,
          rank: run.rank,
          complete: run.complete,
          source: run.source,
        };
      },
      async insertScores() {
        throw new DataError("Accès refusé : cette donnée n'appartient pas à ton compte.");
      },
      async deleteRun() {},
    };

    await expect(saveBenchRunTo(store, { tier: "novice", scores: novice })).rejects.toThrow(
      /Accès refusé.*Rien n'a été gardé\./,
    );
  });
});
