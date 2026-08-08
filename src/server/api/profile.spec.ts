/**
 * Tests d'intégration du profil (singleton). Voir l'entête de
 * `bench-runs.spec.ts` pour le choix du runner `bun test`.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import type { Hono } from "hono";
import { createApp } from "../app";
import { openDatabase } from "../db/client";

let app: Hono;

beforeEach(() => {
  app = createApp(openDatabase(":memory:"));
});

async function put(body: unknown): Promise<Response> {
  return app.request("/api/profile", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const EMPTY_PROFILE = {
  pseudo: null,
  currentRank: null,
  peakRank: null,
  mainAgent: null,
  goal: null,
  weakMapsNotes: null,
};

describe("GET /api/profile", () => {
  it("rend un profil vide (200) tant qu'aucun PUT n'a eu lieu", async () => {
    const res = await app.request("/api/profile");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(EMPTY_PROFILE);
  });
});

describe("PUT /api/profile", () => {
  it("crée le profil puis le relit à l'identique", async () => {
    const body = {
      pseudo: "Fallrod",
      currentRank: "Ascendant 2",
      peakRank: "Immortal 1",
      mainAgent: "Jett",
      goal: "Immortal 3",
      weakMapsNotes: "Icebox: mauvais timings mid",
    };

    const res = await put(body);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
    expect(await (await app.request("/api/profile")).json()).toEqual(body);
  });

  it("fusionne un PUT partiel : les champs absents sont conservés", async () => {
    await put({ pseudo: "Fallrod", mainAgent: "Jett" });
    const res = await put({ mainAgent: "Raze" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ...EMPTY_PROFILE,
      pseudo: "Fallrod",
      mainAgent: "Raze",
    });
  });

  it("efface un champ quand il est explicitement null", async () => {
    await put({ pseudo: "Fallrod", mainAgent: "Jett" });
    const res = await put({ mainAgent: null });

    expect(await res.json()).toEqual({ ...EMPTY_PROFILE, pseudo: "Fallrod" });
  });

  it("refuse un champ du mauvais type (400)", async () => {
    const res = await put({ pseudo: 42 });

    expect(res.status).toBe(400);
    expect((await res.json()).issues).toBeDefined();
  });

  it("refuse un corps JSON invalide (400)", async () => {
    const res = await app.request("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "nope",
    });

    expect(res.status).toBe(400);
  });

  it("reste un singleton : deux PUT ne créent pas deux profils", async () => {
    await put({ pseudo: "A" });
    await put({ pseudo: "B" });

    expect(await (await app.request("/api/profile")).json()).toEqual({
      ...EMPTY_PROFILE,
      pseudo: "B",
    });
  });
});
