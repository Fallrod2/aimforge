/**
 * Tests d'intégration de l'API bench runs, via `app.request()` sur une DB
 * SQLite en mémoire recréée avant chaque test (isolation totale).
 *
 * Runner : `bun test` (et non vitest) — `drizzle-orm/bun-sqlite` a besoin du
 * builtin `bun:sqlite`, que Node (donc vitest) ne sait pas charger.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import type { Hono } from "hono";
import { createApp } from "../app";
import { type AppDatabase, openDatabase } from "../db/client";
import { scenarioScores } from "../db/schema";
import { anchorEnergy, scoresAtAnchor } from "./fixtures";

let db: AppDatabase;
let app: Hono;

beforeEach(() => {
  db = openDatabase(":memory:");
  app = createApp(db);
});

async function post(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function put(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/bench-runs", () => {
  it("crée un bench complet et calcule overall, rang et complete", async () => {
    const res = await post("/api/bench-runs", {
      tier: "novice",
      date: "2026-03-01T12:00:00.000Z",
      scores: scoresAtAnchor("novice", "Gold"),
    });

    expect(res.status).toBe(201);
    const run = await res.json();

    expect(run.tier).toBe("novice");
    expect(run.date).toBe("2026-03-01T12:00:00.000Z");
    expect(run.overall).toBeCloseTo(anchorEnergy("novice", "Gold"), 5);
    expect(run.overall).toBeCloseTo(400, 5);
    expect(run.rank).toBe("Gold");
    expect(run.complete).toBe(true);
    expect(run.scores).toHaveLength(18);
    expect(run.subcategories).toHaveLength(9);
    for (const sub of run.subcategories) {
      expect(sub.energy).toBeCloseTo(400, 5);
    }
    expect(typeof run.id).toBe("number");
  });

  it("accepte un bench partiel : overall 0, rank null, complete false", async () => {
    const res = await post("/api/bench-runs", {
      tier: "novice",
      scores: { "VT Pasu Novice": 807, "VT Popcorn Novice": 100 },
    });

    expect(res.status).toBe(201);
    const run = await res.json();

    expect(run.overall).toBe(0);
    expect(run.rank).toBeNull();
    expect(run.complete).toBe(false);
    expect(run.scores).toHaveLength(2);
    // Les 2 scénarios joués appartiennent à la même sous-catégorie (Dynamic) :
    // elle est renseignée, les 8 autres sont à 0.
    expect(run.subcategories.filter((s: { energy: number }) => s.energy > 0)).toHaveLength(1);
  });

  it("horodate en UTC quand la date est absente", async () => {
    const before = Date.now();
    const res = await post("/api/bench-runs", {
      tier: "novice",
      scores: { "VT Pasu Novice": 807 },
    });
    const run = await res.json();

    expect(res.status).toBe(201);
    expect(run.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(run.date)).toBeGreaterThanOrEqual(before - 1000);
  });

  it("refuse un palier inconnu (400)", async () => {
    const res = await post("/api/bench-runs", {
      tier: "expert",
      scores: { "VT Pasu Novice": 807 },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });

  it("refuse un scénario inconnu pour le palier, en nommant le fautif (400)", async () => {
    const res = await post("/api/bench-runs", {
      tier: "novice",
      scores: { "VT Pasu Novice": 807, "VT Pasu Advanced": 900 },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("VT Pasu Advanced");
  });

  it("refuse un score négatif (400)", async () => {
    const res = await post("/api/bench-runs", {
      tier: "novice",
      scores: { "VT Pasu Novice": -1 },
    });

    expect(res.status).toBe(400);
    expect((await res.json()).issues).toBeDefined();
  });

  it("refuse un payload sans scores (400)", async () => {
    const res = await post("/api/bench-runs", { tier: "novice" });

    expect(res.status).toBe(400);
  });

  it("refuse un corps JSON invalide (400)", async () => {
    const res = await app.request("/api/bench-runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ pas du json",
    });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/bench-runs", () => {
  it("liste les résumés triés par date décroissante", async () => {
    await post("/api/bench-runs", {
      tier: "novice",
      date: "2026-01-01T00:00:00.000Z",
      scores: { "VT Pasu Novice": 500 },
    });
    await post("/api/bench-runs", {
      tier: "intermediate",
      date: "2026-02-01T00:00:00.000Z",
      scores: { "VT Pasu Intermediate": 500 },
    });

    const res = await app.request("/api/bench-runs");

    expect(res.status).toBe(200);
    const runs = await res.json();

    expect(runs).toHaveLength(2);
    expect(runs[0].date).toBe("2026-02-01T00:00:00.000Z");
    expect(runs[1].date).toBe("2026-01-01T00:00:00.000Z");
    // Résumé : pas de détail par scénario.
    expect(runs[0].scores).toBeUndefined();
    expect(Object.keys(runs[0]).sort()).toEqual([
      "complete",
      "date",
      "id",
      "overall",
      "rank",
      "tier",
    ]);
  });

  it("filtre par palier", async () => {
    await post("/api/bench-runs", { tier: "novice", scores: { "VT Pasu Novice": 500 } });
    await post("/api/bench-runs", {
      tier: "intermediate",
      scores: { "VT Pasu Intermediate": 500 },
    });

    const res = await app.request("/api/bench-runs?tier=intermediate");
    const runs = await res.json();

    expect(res.status).toBe(200);
    expect(runs).toHaveLength(1);
    expect(runs[0].tier).toBe("intermediate");
  });

  it("refuse un filtre de palier invalide (400)", async () => {
    const res = await app.request("/api/bench-runs?tier=expert");

    expect(res.status).toBe(400);
  });
});

describe("GET /api/bench-runs/:id", () => {
  it("rend le détail avec énergies par scénario et par sous-catégorie", async () => {
    const created = await (
      await post("/api/bench-runs", {
        tier: "novice",
        scores: scoresAtAnchor("novice", "Silver"),
      })
    ).json();

    const res = await app.request(`/api/bench-runs/${created.id}`);

    expect(res.status).toBe(200);
    const run = await res.json();

    expect(run.id).toBe(created.id);
    expect(run.rank).toBe("Silver");
    expect(run.overall).toBeCloseTo(300, 5);
    expect(run.scores).toHaveLength(18);
    expect(run.scores[0]).toHaveProperty("energy");
    expect(run.subcategories).toHaveLength(9);
    expect(run.subcategories[0].energy).toBeCloseTo(300, 5);
  });

  it("répond 404 sur un id inconnu", async () => {
    const res = await app.request("/api/bench-runs/9999");

    expect(res.status).toBe(404);
  });

  it("répond 400 sur un id non numérique", async () => {
    const res = await app.request("/api/bench-runs/abc");

    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/bench-runs/:id", () => {
  it("supprime le run et ses scores (cascade)", async () => {
    const created = await (
      await post("/api/bench-runs", {
        tier: "novice",
        scores: scoresAtAnchor("novice", "Bronze"),
      })
    ).json();

    expect(db.select().from(scenarioScores).all()).toHaveLength(18);

    const res = await app.request(`/api/bench-runs/${created.id}`, { method: "DELETE" });

    expect(res.status).toBe(204);
    expect((await app.request(`/api/bench-runs/${created.id}`)).status).toBe(404);
    expect(db.select().from(scenarioScores).all()).toHaveLength(0);
  });

  it("répond 404 sur un id inconnu", async () => {
    const res = await app.request("/api/bench-runs/9999", { method: "DELETE" });

    expect(res.status).toBe(404);
  });
});

describe("isolation entre tests", () => {
  it("démarre sur une base vide", async () => {
    const res = await app.request("/api/bench-runs");

    expect(await res.json()).toEqual([]);
  });

  it("ne voit pas non plus les runs du test précédent", async () => {
    await put("/api/profile", { pseudo: "x" });
    const res = await app.request("/api/bench-runs");

    expect(await res.json()).toEqual([]);
  });
});
