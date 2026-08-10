/**
 * Le fil du coach (SPEC §5 sexies), vu depuis la fonction serverless.
 *
 * Ce que les modules purs ne peuvent pas prouver, c'est le **câblage** :
 * l'ordre des contrôles (401 → 400 → 503 → quota), le compteur `chat` plutôt
 * que `coach`, le remboursement sur les chemins d'échec, et les deux règles
 * propres au fil :
 *
 * - **rien n'est persisté quand la génération échoue**, le message de
 *   l'utilisateur compris ;
 * - **le marqueur de suggestion ne génère rien**. Il ressort comme une
 *   suggestion, avec le match choisi *par le serveur*, et n'incrémente pas le
 *   compteur des debriefs.
 *
 * Trois modules seulement sont remplacés, et ce sont les trois qui sortent du
 * processus : le client Supabase, le client de service, et l'aiguillage des
 * fournisseurs. Le reste — validation, police de scénarios, quota — est le vrai
 * code.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig, Resolution } from "../../src/server/ai/index.js";
import { DEBRIEF_SUGGESTION_MARKER } from "../../src/shared/coach-thread-contract.js";

const USER = "utilisateur-1";

/** Un match importé tel que `imported_matches` le rend (payload sous contrat). */
const MATCH_ROW = {
  match_id: "m-1",
  payload: {
    matchId: "m-1",
    map: "Ascent",
    mode: "Compétitif",
    agent: "Jett",
    result: "defaite",
    roundsWon: 11,
    roundsLost: 13,
    kills: 18,
    deaths: 14,
    assists: 5,
    adr: 152,
    headshotPercent: 21,
    playedAt: "2026-08-09T19:00:00.000Z",
  },
};

const DEBRIEF_ROW = {
  date: "2026-08-09T20:00:00.000Z",
  resume: "Partie serrée, perdue sur les retakes.",
  points_forts: ["Entrées propres sur A"],
  axes: [{ titre: "Retakes", detail: "Entrez groupés après la pose." }],
  focus: "Viseur à hauteur de tête.",
};

interface Rpc {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

/** Une écriture dans le fil, et le client qui l'a faite. */
interface Write {
  readonly via: "jwt" | "service";
  readonly row: Record<string, unknown>;
}

const state = vi.hoisted(() => ({
  /** Les matchs importés visibles par l'appelant (RLS déjà appliquée). */
  matches: [] as unknown[],
  /** Les debriefs visibles, pour le contexte comme pour le badge « débriefé ». */
  debriefs: [] as unknown[],
  /** Les `match_id` déjà débriefés, tels que la requête `in(...)` les rend. */
  debriefedMatches: [] as unknown[],
  /** Le fil déjà enregistré, du plus récent au plus ancien. */
  history: [] as unknown[],
  serviceReady: true,
  incremented: 2,
  refunded: 1,
  rpcs: [] as Rpc[],
  /** Les lignes insérées dans `coach_thread_messages`, avec leur client. */
  inserted: [] as Write[],
  /** Les identifiants retirés par la compensation. */
  compensated: [] as number[],
  nextId: 100,
  userInsertFails: false,
  coachInsertFails: false,
  resolution: null as unknown,
  answers: [] as (string | (() => never))[],
  asked: 0,
}));

/** Une chaîne PostgREST : tout enchaîne, tout finit sur le même résultat. */
class Chain implements PromiseLike<{ data: unknown; error: unknown }> {
  constructor(
    private readonly list: unknown,
    // Surtout pas `single` : une propriété de constructeur du même nom
    // écraserait la méthode `single()` à l'instanciation.
    private readonly row: unknown = null,
    private readonly error: unknown = null,
  ) {}

  select(): this {
    return this;
  }
  eq(): this {
    return this;
  }
  in(): this {
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

/**
 * L'insertion d'une ligne, telle que la base la rend — et **par quel client**
 * elle est passée.
 *
 * C'est tout l'objet de la migration 0015 : la question passe sous le JWT de
 * l'appelant, la réponse du coach sous la service key. Un test qui ne
 * regarderait que le contenu inséré ne verrait pas la différence, et c'est la
 * différence qui compte.
 */
function insertedRow(via: Write["via"], value: Record<string, unknown>): unknown {
  state.inserted = [...state.inserted, { via, row: value }];
  return {
    id: state.nextId++,
    role: value.role,
    content: value.content,
    debrief_id: value.debrief_id ?? null,
    created_at: "2026-08-10T19:05:00.000Z",
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: (token: string) =>
        token === "jeton"
          ? Promise.resolve({ data: { user: { id: USER } }, error: null })
          : Promise.resolve({ data: { user: null }, error: { message: "jeton invalide" } }),
    },
    from: (table: string) => ({
      select: (columns: string) => {
        if (table === "imported_matches") return new Chain(state.matches);
        // Deux lectures de `debriefs` : le contexte (colonnes du debrief) et la
        // recherche du match déjà débriefé (`match_id` seul).
        if (table === "debriefs") {
          return new Chain(columns.trim() === "match_id" ? state.debriefedMatches : state.debriefs);
        }
        if (table === "coach_thread_messages") return new Chain(state.history);
        // Profil et bench : absents, ce n'est pas ce qu'on teste ici.
        return new Chain([], null);
      },
      // Le client de l'appelant n'écrit plus qu'une ligne à la fois, et la
      // policy de la 0015 n'en accepte qu'une sorte : `role = 'user'`.
      insert: (value: Record<string, unknown>) => {
        if (state.userInsertFails) {
          return new Chain(null, null, { code: "42501", message: "RLS" });
        }
        return new Chain(null, insertedRow("jwt", value));
      },
    }),
  }),
}));

vi.mock("./service.js", () => ({
  serviceClient: () =>
    state.serviceReady
      ? {
          from: (table: string) => ({
            select: () => new Chain([], null),
            // La ligne du coach : le seul chemin qui reste depuis la 0015.
            insert: (value: Record<string, unknown>) => {
              if (table === "coach_thread_messages" && state.coachInsertFails) {
                return new Chain(null, null, { message: "insertion refusée" });
              }
              return new Chain(null, insertedRow("service", value));
            },
            delete: () => ({
              eq: (_column: string, id: number) => {
                state.compensated.push(id);
                return Promise.resolve({ data: null, error: null });
              },
            }),
          }),
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
        }
      : null,
}));

vi.mock("../../src/server/ai/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/ai/index.js")>();

  return {
    ...actual,
    resolveModelFor: () => Promise.resolve(state.resolution),
    createAsk: () => () => {
      const answer = state.answers[state.asked] ?? "";

      state.asked += 1;
      if (typeof answer === "function") return Promise.resolve().then(answer);
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

const PERSONAL: ProviderConfig = { ...PLATFORM, source: "user", apiKey: "clef-de-l-utilisateur" };

function resolved(config: ProviderConfig): Resolution {
  return { ok: true, config };
}

const ANSWER = "Dix minutes de deathmatch, puis trois runs de VT Pasu Novice.";

function threadRequest(
  body: Record<string, unknown> = { message: "Que travailler aujourd'hui ?" },
  token = "jeton",
): Request {
  return new Request("https://aimforge.test/api/coach-thread", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function anonymousRequest(): Request {
  return new Request("https://aimforge.test/api/coach-thread", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Coucou" }),
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

function increments(): Rpc[] {
  return state.rpcs.filter((call) => call.name === "increment_ai_usage");
}

function refunds(): Rpc[] {
  return state.rpcs.filter((call) => call.name === "refund_ai_usage");
}

/** Un modèle en panne : la configuration de la plateforme est refusée. */
function unreachable(): () => never {
  return () => {
    throw new Error("réseau injoignable");
  };
}

beforeEach(() => {
  state.matches = [MATCH_ROW];
  state.debriefs = [DEBRIEF_ROW];
  state.debriefedMatches = [];
  state.history = [];
  state.serviceReady = true;
  state.incremented = 2;
  state.refunded = 1;
  state.rpcs = [];
  state.inserted = [];
  state.compensated = [];
  state.nextId = 100;
  state.userInsertFails = false;
  state.coachInsertFails = false;
  state.resolution = resolved(PLATFORM);
  state.answers = [ANSWER];
  state.asked = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("api/coach-thread — ordre des contrôles", () => {
  it("refuse un appel anonyme avant tout le reste", async () => {
    const { POST } = await import("../coach-thread.js");

    state.serviceReady = false;

    const response = await POST(anonymousRequest());

    expect(response.status).toBe(401);
    expect(increments()).toHaveLength(0);
  });

  it("refuse un message vide ou démesuré avant de toucher au quota", async () => {
    const { POST } = await import("../coach-thread.js");

    expect((await POST(threadRequest({ message: "   " }))).status).toBe(400);
    expect((await POST(threadRequest({ message: "a".repeat(2001) }))).status).toBe(400);
    expect(increments()).toHaveLength(0);
  });

  it("répond 503 quand l'IA n'est pas configurée, sans rien enregistrer", async () => {
    const { POST } = await import("../coach-thread.js");

    state.serviceReady = false;

    const response = await POST(threadRequest());

    expect(response.status).toBe(503);
    expect(state.inserted).toHaveLength(0);
  });
});

describe("api/coach-thread — quota", () => {
  it("incrémente le compteur `chat`, et pas celui du debrief", async () => {
    const { POST } = await import("../coach-thread.js");

    await POST(threadRequest());

    expect(increments()).toEqual([
      { name: "increment_ai_usage", args: { p_user_id: USER, p_kind: "chat" } },
    ]);
  });

  it("refuse au-delà de la limite, sans appeler le modèle ni rembourser", async () => {
    const { POST } = await import("../coach-thread.js");

    state.incremented = 21;

    const response = await POST(threadRequest());

    expect(response.status).toBe(429);
    expect(state.asked).toBe(0);
    expect(refunds()).toHaveLength(0);
  });

  it("ne compte rien sur une configuration personnelle", async () => {
    const { POST } = await import("../coach-thread.js");

    state.resolution = resolved(PERSONAL);

    const response = await POST(threadRequest());

    expect(response.status).toBe(200);
    expect(increments()).toHaveLength(0);
    expect((await bodyOf(response)).remaining).toBeNull();
  });
});

describe("api/coach-thread — échecs : rien n'est persisté, le quota est rendu", () => {
  it("rembourse et n'écrit rien quand le modèle est injoignable", async () => {
    const { POST } = await import("../coach-thread.js");

    state.answers = [unreachable()];

    const response = await POST(threadRequest());

    expect(response.status).toBe(502);
    expect(state.inserted).toHaveLength(0);
    expect(refunds()).toHaveLength(1);
  });

  it("rembourse une réponse qui invente un scénario, même après relance", async () => {
    const { POST } = await import("../coach-thread.js");

    state.answers = ["Fais du VT Pasu Master.", "Encore du VT Pasu Master."];

    const response = await POST(threadRequest());

    expect(response.status).toBe(502);
    expect(state.asked).toBe(2);
    expect(state.inserted).toHaveLength(0);
    expect(refunds()).toHaveLength(1);
  });

  it("rembourse quand la question elle-même ne peut pas être écrite", async () => {
    const { POST } = await import("../coach-thread.js");

    state.userInsertFails = true;

    const response = await POST(threadRequest());

    expect(response.status).toBe(500);
    expect(state.inserted).toHaveLength(0);
    expect(refunds()).toHaveLength(1);
  });

  it("retire la question quand la réponse ne peut pas l'être, et rembourse", async () => {
    // La contrepartie du partage entre les deux clients (migration 0015) :
    // l'insertion n'est plus atomique. Un fil ne doit pas garder une question
    // sans réponse — elle repartirait au modèle au tour suivant.
    const { POST } = await import("../coach-thread.js");

    state.coachInsertFails = true;

    const response = await POST(threadRequest());

    expect(response.status).toBe(500);
    expect(state.compensated).toEqual([100]);
    expect(refunds()).toHaveLength(1);
  });
});

describe("api/coach-thread — succès", () => {
  it("enregistre les deux messages ensemble et les rend au client", async () => {
    const { POST } = await import("../coach-thread.js");

    const response = await POST(threadRequest());
    const body = await bodyOf(response);

    expect(response.status).toBe(200);
    // La question sous le JWT, la réponse sous la service key : c'est le
    // partage que la migration 0015 impose, et la seule chose qui empêche un
    // navigateur d'écrire une réplique de coach.
    expect(state.inserted).toEqual([
      { via: "jwt", row: { user_id: USER, role: "user", content: "Que travailler aujourd'hui ?" } },
      { via: "service", row: { user_id: USER, role: "coach", content: ANSWER, debrief_id: null } },
    ]);
    expect(state.compensated).toEqual([]);
    expect(body.question).toMatchObject({ role: "user", debriefId: null });
    expect(body.answer).toMatchObject({ role: "coach", content: ANSWER, debriefId: null });
    expect(body.suggestion).toBeNull();
    expect(body.remaining).toBe(18);
  });

  it("relit le fil existant sans que cela empêche la réponse", async () => {
    const { POST } = await import("../coach-thread.js");

    state.history = [
      { role: "coach", content: "Travaille tes retakes." },
      { role: "user", content: "Et pour la visée ?" },
    ];

    expect((await POST(threadRequest())).status).toBe(200);
  });
});

describe("api/coach-thread — suggestion de debrief", () => {
  it("rend la suggestion sans générer quoi que ce soit, et sans marqueur dans le texte", async () => {
    const { POST } = await import("../coach-thread.js");

    state.answers = [`${ANSWER}\n${DEBRIEF_SUGGESTION_MARKER}`];

    const body = await bodyOf(await POST(threadRequest()));

    expect(body.suggestion).toEqual({ matchId: "m-1" });
    expect(body.answer).toMatchObject({ content: ANSWER });
    // Un seul incrément, et c'est celui du fil : aucun debrief n'a été généré.
    expect(increments()).toHaveLength(1);
    expect(increments()[0]?.args).toMatchObject({ p_kind: "chat" });
    expect(state.inserted).toHaveLength(2);
  });

  it("ne vise aucun match quand le seul match importé est déjà débriefé", async () => {
    const { POST } = await import("../coach-thread.js");

    state.debriefedMatches = [{ match_id: "m-1" }];
    state.answers = [`${ANSWER}\n${DEBRIEF_SUGGESTION_MARKER}`];

    const body = await bodyOf(await POST(threadRequest()));

    expect(body.suggestion).toEqual({ matchId: null });
  });

  it("écarte un match dont le résumé n'est plus lisible plutôt que de l'inventer", async () => {
    const { POST } = await import("../coach-thread.js");

    state.matches = [{ match_id: "m-2", payload: { map: 42 } }];
    state.answers = [`${ANSWER}\n${DEBRIEF_SUGGESTION_MARKER}`];

    const body = await bodyOf(await POST(threadRequest()));

    expect(body.suggestion).toEqual({ matchId: null });
  });
});
