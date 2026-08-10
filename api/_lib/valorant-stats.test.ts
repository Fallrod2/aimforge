/**
 * `api/valorant/stats` vu depuis la fonction serverless (SPEC §5 sexies, V1).
 *
 * L'agrégateur est prouvé ailleurs, sans base
 * (`src/server/valorant/aggregates.test.ts`). Ce qui se prouve ici est le
 * câblage : que la fonction lit les matchs du compte **principal**, qu'elle
 * écarte les lignes hors contrat au lieu de fausser une moyenne, qu'un profil
 * sans compte lié rend un état vide et non une erreur, et que ce qui sort
 * respecte le contrat que le navigateur validera.
 *
 * Sous `api/_lib/` pour la même raison que les autres : le préfixe `_` sort le
 * dossier du routage Vercel.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { valorantStatsResponseSchema } from "../../src/shared/valorant-contract.js";

const USER = "utilisateur-1";

const state = vi.hoisted(() => ({
  /** Le compte Riot principal visible par l'appelant, s'il y en a un. */
  account: { id: 7 } as unknown,
  accountError: null as unknown,
  /** Les lignes de `imported_matches` (RLS déjà appliquée). */
  rows: [] as unknown[],
  rowsError: null as unknown,
}));

class Chain implements PromiseLike<{ data: unknown; error: unknown }> {
  constructor(
    private readonly list: unknown,
    private readonly row: unknown = null,
    private readonly error: unknown = null,
  ) {}

  select(): this {
    return this;
  }
  eq(): this {
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  maybeSingle(): Promise<{ data: unknown; error: unknown }> {
    return Promise.resolve({ data: this.row, error: this.error });
  }
  // biome-ignore lint/suspicious/noThenProperty: imite le constructeur de requête de PostgREST, qui est une promesse.
  then<A, B = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve({ data: this.list, error: this.error }).then(onfulfilled, onrejected);
  }
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: USER } }, error: null }),
    },
    from: (table: string) => ({
      select: () => {
        if (table === "linked_accounts") {
          return new Chain([], state.account, state.accountError);
        }
        if (table === "imported_matches") {
          return new Chain(state.rows, null, state.rowsError);
        }
        return new Chain([], null);
      },
    }),
  }),
}));

/** Un résumé de match tel que `api/valorant/refresh` l'écrit. */
function payload(fields: Record<string, unknown>): { readonly payload: unknown } {
  return {
    payload: {
      matchId: "match-1",
      playedAt: "2026-08-09T18:12:00.000Z",
      map: "Ascent",
      mode: "Competitive",
      agent: "Jett",
      kills: 20,
      deaths: 10,
      assists: 4,
      adr: 160,
      headshotPercent: 24,
      roundsWon: 13,
      roundsLost: 9,
      result: "victoire",
      ...fields,
    },
  };
}

function statsRequest(token = "jeton"): Request {
  return new Request("https://aimforge.test/api/valorant/stats", {
    method: "GET",
    headers: token === "" ? {} : { authorization: `Bearer ${token}` },
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

beforeEach(() => {
  state.account = { id: 7 };
  state.accountError = null;
  state.rows = [];
  state.rowsError = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("api/valorant/stats", () => {
  it("refuse un appel sans jeton", async () => {
    const { GET } = await import("../valorant/stats.js");

    expect((await GET(statsRequest(""))).status).toBe(401);
  });

  it("rend un état vide, et non une erreur, quand aucun compte Riot n'est lié", async () => {
    state.account = null;

    const { GET } = await import("../valorant/stats.js");
    const response = await GET(statsRequest());
    const body = await bodyOf(response);

    expect(response.status).toBe(200);
    expect(valorantStatsResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ accountId: null, matchCount: 0 });
  });

  it("agrège les matchs du compte principal et respecte le contrat", async () => {
    state.rows = [
      payload({ matchId: "a", result: "victoire", kills: 20, deaths: 10, headshotPercent: 20 }),
      payload({ matchId: "b", result: "defaite", kills: 10, deaths: 20, headshotPercent: 30 }),
    ];

    const { GET } = await import("../valorant/stats.js");
    const response = await GET(statsRequest());
    const parsed = valorantStatsResponseSchema.safeParse(await bodyOf(response));

    expect(response.status).toBe(200);
    expect(parsed.success).toBe(true);

    const stats = parsed.data;

    expect(stats?.accountId).toBe(7);
    expect(stats?.matchCount).toBe(2);
    expect(stats?.stats.periods.all.winrate).toBe(50);
    expect(stats?.stats.periods.all.kd).toBe(1);
    expect(stats?.stats.periods.all.headshotPercent).toBe(25);
    expect(stats?.stats.byAgent[0]?.key).toBe("Jett");
    expect(stats?.stats.trend.map((point) => point.matchId)).toEqual(["a", "b"]);
  });

  it("écarte une ligne stockée hors contrat plutôt que de fausser les moyennes", async () => {
    state.rows = [payload({ matchId: "a" }), { payload: { matchId: "b", kills: "beaucoup" } }];

    const { GET } = await import("../valorant/stats.js");
    const body = await bodyOf(await GET(statsRequest()));

    expect(body.matchCount).toBe(1);
  });

  it("refuse en bloc quand la lecture des matchs échoue", async () => {
    state.rowsError = { message: "timeout" };

    const { GET } = await import("../valorant/stats.js");
    const response = await GET(statsRequest());

    expect(response.status).toBe(500);
  });
});
