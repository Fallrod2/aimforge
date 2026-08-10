/**
 * `api/valorant/match` vu depuis la fonction serverless (SPEC §5 sexies, V1).
 *
 * Les modules purs prouvent le résumé ; ce qu'ils ne peuvent pas prouver, c'est
 * le **câblage** : qu'un match qui n'est pas à l'appelant est indiscernable
 * d'un match inexistant (404), qu'un détail déjà en cache ne coûte **aucun**
 * appel à la source, que ce qui entre en base est bien le résumé structuré, et
 * qu'une clé absente se dit posément (503) au lieu de partir en aller-retour.
 *
 * Le fichier vit sous `api/_lib/` — comme `coach-match.test.ts` — parce que le
 * préfixe `_` sort le dossier du routage Vercel : un fichier de test posé dans
 * `api/valorant/` deviendrait une route sans gestionnaire.
 *
 * Trois modules seulement sont remplacés, et ce sont les trois qui sortent du
 * processus : le client Supabase, le client de service, et l'appel HenrikDev.
 * Tout le reste — lecture du corps, possession du match, résumé, validation du
 * contrat — est le vrai code.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "utilisateur-1";

const MATCH_ID = "0f7d3b21-2f2c-4a6e-9a1b-8c2d5e6f7a8b";

const PUUID = "puuid-du-joueur";

/** Une réponse v4 réduite : deux joueurs, deux équipes, deux rounds. */
const HENRIK_DETAIL = {
  metadata: {
    match_id: MATCH_ID,
    map: { name: "Ascent" },
    started_at: "2026-08-09T18:12:00.000Z",
    queue: { name: "Competitive" },
  },
  players: [
    {
      puuid: PUUID,
      name: "Moi",
      team_id: "Blue",
      agent: { name: "Jett" },
      stats: {
        score: 5200,
        kills: 18,
        deaths: 14,
        assists: 5,
        headshots: 21,
        bodyshots: 60,
        legshots: 19,
        damage: { dealt: 3200 },
      },
    },
    { puuid: "adversaire", name: "Autre", team_id: "Red", agent: { name: "Sova" } },
  ],
  teams: [
    { team_id: "Blue", won: false, rounds: { won: 11, lost: 13 } },
    { team_id: "Red", won: true, rounds: { won: 13, lost: 11 } },
  ],
  rounds: [
    { winning_team: "Blue", plant: { player: { puuid: "poseur", team: "Blue" } } },
    { winning_team: "Red" },
  ],
};

interface Upsert {
  readonly table: string;
  readonly values: unknown;
}

const state = vi.hoisted(() => ({
  /** La ligne de `imported_matches` visible par l'appelant (RLS appliquée). */
  owned: { linked_account_id: 7 } as unknown,
  /** La ligne de `match_details` déjà en cache, s'il y en a une. */
  cached: null as unknown,
  cacheError: null as unknown,
  // Les littéraux sont recopiés : `vi.hoisted` remonte ce bloc au-dessus des
  // constantes du fichier, qui ne sont donc pas encore initialisées ici.
  account: { riot_puuid: "puuid-du-joueur", riot_region: "eu" } as unknown,
  key: "clef-henrikdev",
  upserts: [] as Upsert[],
  upsertError: null as unknown,
  /** Nombre d'appels réellement partis vers la source. */
  fetched: 0,
  /** Erreur à lever depuis `fetchMatchDetail`, quand le test en veut une. */
  fetchError: null as unknown,
  /** Rempli par `beforeEach` avec `HENRIK_DETAIL` (voir la note ci-dessus). */
  detail: null as unknown,
}));

/** Une chaîne PostgREST : tout enchaîne, tout finit sur le même résultat. */
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
        if (table === "imported_matches") return new Chain([], state.owned);
        if (table === "match_details") return new Chain([], state.cached, state.cacheError);
        if (table === "linked_accounts") return new Chain([], state.account);
        return new Chain([], null);
      },
      upsert: (values: unknown) => {
        state.upserts.push({ table, values });
        return new Chain(null, null, state.upsertError);
      },
    }),
  }),
}));

vi.mock("./service.js", () => ({ serviceClient: () => null }));

vi.mock("./platform-settings.js", () => ({
  loadPlatformSettings: () => Promise.resolve({ henrikdevKey: state.key }),
}));

vi.mock("./henrikdev.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./henrikdev.js")>();

  return {
    ...actual,
    fetchMatchDetail: () => {
      state.fetched += 1;
      if (state.fetchError !== null) return Promise.reject(state.fetchError);
      return Promise.resolve(state.detail);
    },
  };
});

function matchRequest(body: unknown, token = "jeton"): Request {
  return new Request("https://aimforge.test/api/valorant/match", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === "" ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

beforeEach(() => {
  state.owned = { linked_account_id: 7 };
  state.cached = null;
  state.cacheError = null;
  state.account = { riot_puuid: PUUID, riot_region: "eu" };
  state.key = "clef-henrikdev";
  state.upserts = [];
  state.upsertError = null;
  state.fetched = 0;
  state.fetchError = null;
  state.detail = HENRIK_DETAIL;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("api/valorant/match", () => {
  it("refuse un appel sans jeton, avant toute autre considération", async () => {
    const { POST } = await import("../valorant/match.js");
    const response = await POST(matchRequest({ match_id: MATCH_ID }, ""));

    expect(response.status).toBe(401);
    expect(state.fetched).toBe(0);
  });

  it("refuse un corps sans identifiant de match", async () => {
    const { POST } = await import("../valorant/match.js");

    expect((await POST(matchRequest({}))).status).toBe(400);
    expect((await POST(matchRequest({ match_id: "" }))).status).toBe(400);
    expect(state.fetched).toBe(0);
  });

  it("refuse un match qui n'est pas dans les matchs importés de l'appelant", async () => {
    // La RLS ne rend rien : match inexistant ou match de quelqu'un d'autre —
    // indiscernables, et c'est exactement la réponse qu'on veut donner.
    state.owned = null;

    const { POST } = await import("../valorant/match.js");
    const response = await POST(matchRequest({ match_id: MATCH_ID }));

    expect(response.status).toBe(404);
    expect(state.fetched).toBe(0);
  });

  it("sert le cache sans appeler la source", async () => {
    state.cached = {
      payload: {
        matchId: MATCH_ID,
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
      },
    };

    const { POST } = await import("../valorant/match.js");
    const response = await POST(matchRequest({ match_id: MATCH_ID }));
    const body = await bodyOf(response);

    expect(response.status).toBe(200);
    expect(body.cached).toBe(true);
    expect(state.fetched).toBe(0);
    expect(state.upserts).toHaveLength(0);
  });

  it("ignore une ligne de cache hors contrat et repasse par la source", async () => {
    state.cached = { payload: { matchId: MATCH_ID, scoreboard: "pas un tableau" } };

    const { POST } = await import("../valorant/match.js");
    const response = await POST(matchRequest({ match_id: MATCH_ID }));

    expect(response.status).toBe(200);
    expect((await bodyOf(response)).cached).toBe(false);
    expect(state.fetched).toBe(1);
  });

  it("résume le détail, le met en cache, et le rend", async () => {
    const { POST } = await import("../valorant/match.js");
    const response = await POST(matchRequest({ match_id: MATCH_ID }));
    const body = await bodyOf(response);

    expect(response.status).toBe(200);
    expect(body.cached).toBe(false);
    expect(state.fetched).toBe(1);
    expect(body.detail).toMatchObject({
      matchId: MATCH_ID,
      map: "Ascent",
      team: "bleue",
      result: "defaite",
      roundsWon: 11,
      roundsLost: 13,
    });

    const upsert = state.upserts[0];
    const values = upsert?.values as Record<string, unknown>;

    // Ce qui entre en base est le résumé structuré, sous l'identité vérifiée de
    // l'appelant — jamais la réponse brute, jamais un `user_id` du corps.
    expect(upsert?.table).toBe("match_details");
    expect(values.user_id).toBe(USER);
    expect(values.match_id).toBe(MATCH_ID);
    expect(values.payload).toEqual(body.detail);
  });

  it("rend le détail même si la mise en cache échoue", async () => {
    state.upsertError = { code: "42501", message: "policy" };

    const { POST } = await import("../valorant/match.js");
    const response = await POST(matchRequest({ match_id: MATCH_ID }));

    expect(response.status).toBe(200);
    expect((await bodyOf(response)).cached).toBe(false);
  });

  it("annonce la fonctionnalité non configurée quand la clé est absente", async () => {
    state.key = "   ";

    const { POST } = await import("../valorant/match.js");
    const response = await POST(matchRequest({ match_id: MATCH_ID }));

    expect(response.status).toBe(503);
    expect(state.fetched).toBe(0);
  });

  it("propage le statut et le message d'un échec de la source", async () => {
    const { HenrikError } = await import("./henrikdev.js");

    state.fetchError = new HenrikError("Le détail de cette partie n'est plus disponible.", 404);

    const { POST } = await import("../valorant/match.js");
    const response = await POST(matchRequest({ match_id: MATCH_ID }));

    expect(response.status).toBe(404);
    expect((await bodyOf(response)).error).toContain("n'est plus disponible");
    expect(state.upserts).toHaveLength(0);
  });

  it("refuse un détail où le joueur n'apparaît pas, sans rien mettre en cache", async () => {
    state.detail = { ...HENRIK_DETAIL, players: [{ puuid: "quelqu-un-d-autre" }] };

    const { POST } = await import("../valorant/match.js");
    const response = await POST(matchRequest({ match_id: MATCH_ID }));

    expect(response.status).toBe(502);
    expect(state.upserts).toHaveLength(0);
  });

  it("refuse un compte lié sans identifiant Riot, sans appeler la source", async () => {
    state.account = { riot_puuid: null, riot_region: "eu" };

    const { POST } = await import("../valorant/match.js");
    const response = await POST(matchRequest({ match_id: MATCH_ID }));

    expect(response.status).toBe(409);
    expect(state.fetched).toBe(0);
  });
});
