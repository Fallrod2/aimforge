/**
 * Le debrief en un clic depuis un match importé (SPEC §5 ter bis), vu depuis la
 * fonction serverless.
 *
 * Ce que les modules purs ne peuvent pas prouver, c'est le **câblage** : que le
 * texte de stats vient de la base et non du navigateur, qu'un match qui n'est
 * pas à l'appelant est indiscernable d'un match inexistant (404), qu'un match
 * déjà débriefé est refusé **avant** de coûter un quota (409), et que la
 * référence du match finit bien sur le debrief enregistré.
 *
 * Le fichier vit sous `api/_lib/` — comme `quota-refund.test.ts` — parce que le
 * préfixe `_` sort le dossier du routage Vercel : un fichier de test posé dans
 * `api/` deviendrait une route sans gestionnaire.
 *
 * Trois modules seulement sont remplacés, et ce sont les trois qui sortent du
 * processus : le client Supabase, le client de service, et l'aiguillage des
 * fournisseurs. Tout le reste — lecture du corps, résolution du match, mise en
 * texte, quota, police de scénarios — est le vrai code.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig, Resolution } from "../../src/server/ai/index.js";

const USER = "utilisateur-1";

const MATCH_ID = "0f7d3b21-2f2c-4a6e-9a1b-8c2d5e6f7a8b";

/** Un résumé de match tel que `api/valorant/refresh` l'écrit. */
const PAYLOAD = {
  matchId: MATCH_ID,
  playedAt: "2026-08-09T18:12:00.000Z",
  map: "Ascent",
  mode: "Compétitif",
  agent: "Jett",
  kills: 18,
  deaths: 14,
  assists: 5,
  adr: 152,
  headshotPercent: 21,
  roundsWon: 11,
  roundsLost: 13,
  result: "defaite",
};

interface Rpc {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

interface Insert {
  readonly table: string;
  readonly values: unknown;
}

const state = vi.hoisted(() => ({
  /** Les matchs importés visibles par l'appelant (RLS déjà appliquée). */
  matches: [] as unknown[],
  /** Les debriefs déjà posés sur ce match. */
  existingDebriefs: [] as unknown[],
  /** Le compteur rendu par `increment_ai_usage`. */
  incremented: 2,
  refunded: 1,
  rpcs: [] as Rpc[],
  inserts: [] as Insert[],
  /** Code d'erreur Postgres à simuler sur l'insertion (`23505` = doublon). */
  insertErrorCode: null as string | null,
  resolution: null as unknown,
  answers: [] as string[],
  asked: 0,
}));

/** Une chaîne PostgREST : tout enchaîne, tout finit sur le même résultat. */
class Chain implements PromiseLike<{ data: unknown; error: unknown }> {
  constructor(
    private readonly list: unknown,
    // Surtout pas `single` : une propriété de constructeur du même nom écraserait
    // la méthode `single()` à l'instanciation, et la chaîne cesserait d'imiter
    // PostgREST au moment précis où on croit la tester.
    private readonly row: unknown = null,
    private readonly error: unknown = null,
  ) {}

  select(): this {
    return this;
  }
  eq(): this {
    return this;
  }
  not(): this {
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
  single(): Promise<{ data: unknown; error: unknown }> {
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
        if (table === "imported_matches") return new Chain(state.matches);
        if (table === "debriefs") return new Chain(state.existingDebriefs, null);
        // Profil et bench : absents, ce n'est pas ce qu'on teste ici.
        return new Chain([], null);
      },
      insert: (values: unknown) => {
        state.inserts.push({ table, values });
        return state.insertErrorCode === null
          ? new Chain(null, { id: 12, date: "2026-08-09T19:00:00.000Z", match_id: MATCH_ID })
          : new Chain(null, null, { code: state.insertErrorCode, message: "doublon" });
      },
    }),
  }),
}));

vi.mock("./service.js", () => ({
  serviceClient: () => ({
    from: () => ({ select: () => new Chain([], null) }),
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcs.push({ name, args });
      switch (name) {
        case "increment_ai_usage":
          return Promise.resolve({ data: state.incremented, error: null });
        case "refund_ai_usage":
          return Promise.resolve({ data: state.refunded, error: null });
        default:
          return Promise.resolve({ data: 0, error: null });
      }
    },
  }),
}));

vi.mock("../../src/server/ai/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/ai/index.js")>();

  return {
    ...actual,
    resolveModelFor: () => Promise.resolve(state.resolution),
    createAsk: () => () => {
      const answer = state.answers[state.asked] ?? "";

      state.asked += 1;
      return Promise.resolve(answer);
    },
  };
});

const PLATFORM: ProviderConfig = {
  source: "platform",
  provider: "openrouter",
  model: "deepseek/deepseek-chat",
  baseUrl: null,
  apiKey: "clef-de-la-plateforme",
};

function resolved(config: ProviderConfig): Resolution {
  return { ok: true, config };
}

const DEBRIEF = JSON.stringify({
  resume: "Partie serrée, perdue sur les retakes.",
  points_forts: ["Entrées propres sur A"],
  axes: [{ titre: "Retakes", detail: "Entrez groupés après la pose." }],
  focus: "Viseur à hauteur de tête.",
});

function coachRequest(body: Record<string, unknown>): Request {
  return new Request("https://aimforge.test/api/coach", {
    method: "POST",
    headers: { authorization: "Bearer jeton", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

function debriefInsert(): Record<string, unknown> | null {
  const insert = state.inserts.find((entry) => entry.table === "debriefs") ?? null;

  return insert === null ? null : (insert.values as Record<string, unknown>);
}

beforeEach(() => {
  state.matches = [{ payload: PAYLOAD }];
  state.existingDebriefs = [];
  state.incremented = 2;
  state.refunded = 1;
  state.rpcs = [];
  state.inserts = [];
  state.insertErrorCode = null;
  state.resolution = resolved(PLATFORM);
  state.answers = [DEBRIEF];
  state.asked = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("api/coach — debrief d'un match importé", () => {
  it("formate le match côté serveur et attache sa référence au debrief", async () => {
    const { POST } = await import("../coach.js");
    const response = await POST(coachRequest({ match_id: MATCH_ID }));

    expect(response.status).toBe(200);

    const insert = debriefInsert();

    // Le texte vient de la base, pas du navigateur : c'est ce qui empêche de
    // mentir sur le contenu du match tout en gardant le badge « débriefé ».
    expect(insert?.input_raw).toContain("Partie Valorant importée automatiquement");
    expect(insert?.input_raw).toContain("- Map : Ascent");
    expect(insert?.match_id).toBe(MATCH_ID);
    expect((await bodyOf(response)).debrief).toMatchObject({ id: 12, match_id: MATCH_ID });
  });

  it("refuse un match invisible pour l'appelant, sans rien consommer", async () => {
    // La RLS ne rend rien : match inexistant ou match de quelqu'un d'autre —
    // indiscernables, et c'est exactement la réponse qu'on veut donner.
    state.matches = [];

    const { POST } = await import("../coach.js");
    const response = await POST(coachRequest({ match_id: MATCH_ID }));

    expect(response.status).toBe(404);
    expect(state.rpcs).toEqual([]);
    expect(state.asked).toBe(0);
  });

  it("refuse un match déjà débriefé, avant le quota, et dit lequel", async () => {
    state.existingDebriefs = [{ id: 42 }];

    const { POST } = await import("../coach.js");
    const response = await POST(coachRequest({ match_id: MATCH_ID }));

    expect(response.status).toBe(409);
    expect(await bodyOf(response)).toEqual({
      error: expect.stringContaining("déjà été débriefé"),
      debrief_id: 42,
    });
    expect(state.rpcs).toEqual([]);
    expect(state.asked).toBe(0);
  });

  it("refuse un résumé de match hors contrat plutôt que d'en donner les morceaux", async () => {
    state.matches = [{ payload: { map: "Ascent" } }];

    const { POST } = await import("../coach.js");
    const response = await POST(coachRequest({ match_id: MATCH_ID }));

    expect(response.status).toBe(422);
    expect(state.asked).toBe(0);
  });

  it("traduit la course entre deux clics en 409, et rembourse le quota", async () => {
    // L'index unique de la migration 0011 refuse la seconde insertion : le
    // debrief demandé existe, donc ce n'est pas une panne — mais cette
    // requête-ci n'a rien produit, elle ne doit rien coûter.
    state.insertErrorCode = "23505";
    state.existingDebriefs = [];

    const { POST } = await import("../coach.js");
    const response = await POST(coachRequest({ match_id: MATCH_ID }));

    expect(response.status).toBe(409);
    expect(state.rpcs.filter((call) => call.name === "refund_ai_usage")).toHaveLength(1);
  });

  it("laisse le chemin du collage manuel intact : aucune référence de match", async () => {
    const { POST } = await import("../coach.js");
    const response = await POST(coachRequest({ stats: "Ascent · Jett · 18/14/5" }));

    expect(response.status).toBe(200);
    expect(debriefInsert()?.match_id).toBeNull();
    expect(debriefInsert()?.input_raw).toBe("Ascent · Jett · 18/14/5");
  });

  it("refuse un corps qui ne porte ni stats ni référence de match", async () => {
    const { POST } = await import("../coach.js");
    const response = await POST(coachRequest({ matchId: MATCH_ID }));

    expect(response.status).toBe(400);
    expect(state.rpcs).toEqual([]);
  });
});
