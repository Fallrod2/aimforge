/**
 * L'appel des fonctions Valorant, côté navigateur.
 *
 * Ce qui se prouve ici tient en une phrase : **une réponse qu'on ne comprend
 * pas ne devient jamais une donnée**. Un corps hors contrat, un 404 servi par
 * Vite en développement, une session absente — chacun doit donner une
 * `ValorantError` avec le bon statut et une phrase affichable, jamais un objet
 * à moitié rempli qui casserait un écran trois composants plus loin.
 *
 * Ni réseau ni Supabase : `fetch` et le client sont remplacés.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callValorant, ValorantError } from "./valorant-call";

const state = vi.hoisted(() => ({
  token: "jeton" as string | undefined,
  status: 200,
  body: "{}",
  /** Ce que la dernière requête a réellement demandé. */
  calls: [] as { url: string; init: RequestInit }[],
}));

vi.mock("../supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { access_token: state.token } }, error: null }),
    },
  },
}));

const schema = z.object({ ok: z.boolean() });

/** L'échec attendu d'un appel : typé, pour que le test parle de `ValorantError`. */
async function failureOf(call: Promise<unknown>): Promise<ValorantError> {
  try {
    await call;
  } catch (cause) {
    if (cause instanceof ValorantError) return cause;
    throw cause;
  }
  throw new Error("cet appel devait échouer");
}

beforeEach(() => {
  state.token = "jeton";
  state.status = 200;
  state.body = JSON.stringify({ ok: true });
  state.calls = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    state.calls.push({ url, init });
    return Promise.resolve(new Response(state.body, { status: state.status }));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("callValorant", () => {
  it("lit en GET sans corps, et écrit en POST quand il y a une charge", async () => {
    await callValorant("/api/valorant/stats", schema);
    await callValorant("/api/valorant/match", schema, { match_id: "abc" });

    expect(state.calls[0]?.init.method).toBe("GET");
    expect(state.calls[0]?.init.body).toBeUndefined();
    expect(state.calls[1]?.init.method).toBe("POST");
    expect(state.calls[1]?.init.body).toBe(JSON.stringify({ match_id: "abc" }));
    // Le jeton part à la main : les fonctions ne lisent pas les cookies.
    const headers = state.calls[0]?.init.headers as Record<string, string>;

    expect(headers.authorization).toBe("Bearer jeton");
  });

  it("refuse d'appeler sans session, et le dit comme un 401", async () => {
    state.token = undefined;

    await expect(callValorant("/api/valorant/stats", schema)).rejects.toMatchObject({
      name: "ValorantError",
      status: 401,
    });
    expect(state.calls).toHaveLength(0);
  });

  it("reprend le message de la fonction quand elle en donne un", async () => {
    state.status = 404;
    state.body = JSON.stringify({ error: "Cette partie n'est pas dans tes matchs importés." });

    const failure = await failureOf(callValorant("/api/valorant/match", schema, {}));

    expect(failure.status).toBe(404);
    expect(failure.message).toContain("matchs importés");
    expect(failure.notFound).toBe(true);
  });

  it("explique le 404 non-JSON par l'absence des fonctions en développement", async () => {
    state.status = 404;
    state.body = "<!doctype html><title>404</title>";

    const failure = await failureOf(callValorant("/api/valorant/stats", schema));

    expect(failure.message).toContain("bunx vercel dev");
  });

  it("distingue non configuré et trop d'appels, que l'écran traite à part", async () => {
    state.status = 503;
    state.body = JSON.stringify({ error: "Import Valorant non configuré." });

    const notConfigured = await failureOf(callValorant("/api/valorant/stats", schema));

    expect(notConfigured.notConfigured).toBe(true);

    state.status = 429;
    state.body = JSON.stringify({ error: "Trop d'appels." });

    const limited = await failureOf(callValorant("/api/valorant/stats", schema));

    expect(limited.rateLimited).toBe(true);
  });

  it("rejette un corps qui ne respecte pas le contrat", async () => {
    state.body = JSON.stringify({ ok: "peut-être" });

    await expect(callValorant("/api/valorant/stats", schema)).rejects.toBeInstanceOf(ValorantError);

    state.body = "pas du JSON";

    await expect(callValorant("/api/valorant/stats", schema)).rejects.toBeInstanceOf(ValorantError);
  });

  it("traduit une panne de réseau en échec sans statut", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));

    await expect(callValorant("/api/valorant/stats", schema)).rejects.toMatchObject({ status: 0 });
  });
});
