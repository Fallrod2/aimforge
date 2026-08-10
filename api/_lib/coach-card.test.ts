/**
 * La carte debrief posée dans le fil par `api/coach` (SPEC §5 sexies,
 * migration 0015).
 *
 * C'est le pont dashboard → fil, vu du côté qui l'écrit. Ce que les modules
 * purs ne peuvent pas prouver, c'est **qui écrit quoi** : depuis la 0015, le
 * navigateur n'a plus le droit d'insérer une ligne `role = 'coach'`, donc la
 * carte n'a plus qu'un seul chemin possible — cette fonction, sous la service
 * key, après avoir vérifié sous le JWT de l'appelant que le debrief est bien le
 * sien.
 *
 * Quatre propriétés sont vérifiées ici, et chacune correspond à une façon dont
 * le pont s'est déjà cassé ou pourrait se casser :
 *
 * 1. sans `thread`, rien n'est posé — un collage manuel n'est pas un tour de
 *    conversation ;
 * 2. avec `thread`, **deux** lignes sont posées, la question sous le JWT et la
 *    carte sous la service key, et la réponse les rend au client ;
 * 3. un échec de la pose ne fait pas échouer le debrief : il est généré,
 *    enregistré et facturé, donc il est rendu quand même ;
 * 4. la question orpheline est retirée si la carte ne suit pas.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig, Resolution } from "../../src/server/ai/index.js";

const USER = "utilisateur-1";

const MATCH_ID = "11111111-2222-3333-4444-555555555555";

const DEBRIEF_ID = 12;

const RESUME = "Partie serrée sur Ascent, perdue sur les retakes.";

/** Une écriture dans le fil, et le client qui l'a faite. */
interface Write {
  readonly via: "jwt" | "service";
  readonly row: Record<string, unknown>;
}

const state = vi.hoisted(() => ({
  /** Le debrief est-il visible par l'appelant ? (la RLS répond à sa place) */
  debriefVisible: true,
  /** Les lignes posées dans `coach_thread_messages`, avec leur client. */
  writes: [] as Write[],
  compensated: [] as number[],
  nextId: 200,
  userInsertFails: false,
  coachInsertFails: false,
  resolution: null as unknown,
  answer: "",
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

function written(via: Write["via"], row: Record<string, unknown>): unknown {
  state.writes = [...state.writes, { via, row }];
  return {
    id: state.nextId++,
    role: row.role,
    content: row.content,
    debrief_id: row.debrief_id ?? null,
    created_at: "2026-08-10T19:05:00.000Z",
  };
}

const MATCH_PAYLOAD = {
  matchId: MATCH_ID,
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
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: USER } }, error: null }),
    },
    from: (table: string) => ({
      select: (columns: string) => {
        if (table === "imported_matches") return new Chain([{ payload: MATCH_PAYLOAD }]);
        if (table === "debriefs") {
          // Deux lectures très différentes : « ce match a-t-il déjà un
          // debrief ? » (une liste, vide ici) et « ce debrief est-il le mien ? »
          // (une ligne, celle que la carte veut référencer).
          return columns.trim() === "id"
            ? new Chain([], state.debriefVisible ? { id: DEBRIEF_ID } : null)
            : new Chain([], null);
        }
        return new Chain([], null);
      },
      insert: (values: Record<string, unknown>) => {
        if (table === "debriefs") {
          return new Chain(null, {
            id: DEBRIEF_ID,
            date: "2026-08-10T19:00:00.000Z",
            match_id: values.match_id ?? null,
          });
        }
        if (state.userInsertFails) return new Chain(null, null, { code: "42501", message: "RLS" });
        return new Chain(null, written("jwt", values));
      },
    }),
  }),
}));

vi.mock("./service.js", () => ({
  serviceClient: () => ({
    from: (table: string) => ({
      select: () => new Chain([], null),
      insert: (values: Record<string, unknown>) => {
        if (table === "coach_thread_messages" && state.coachInsertFails) {
          return new Chain(null, null, { message: "insertion refusée" });
        }
        return new Chain(null, written("service", values));
      },
      delete: () => ({
        eq: (_column: string, id: number) => {
          state.compensated.push(id);
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
    rpc: (name: string) =>
      name === "increment_ai_usage"
        ? Promise.resolve({ data: 1, error: null })
        : Promise.resolve({ data: 0, error: null }),
  }),
}));

vi.mock("../../src/server/ai/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/ai/index.js")>();

  return {
    ...actual,
    resolveModelFor: () => Promise.resolve(state.resolution),
    createAsk: () => () => Promise.resolve(state.answer),
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

const DEBRIEF_JSON = JSON.stringify({
  resume: RESUME,
  points_forts: ["Entrées propres sur A"],
  axes: [{ titre: "Retakes", detail: "Entrez groupés après la pose." }],
  focus: "Ne jamais retake seul.",
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

beforeEach(() => {
  state.debriefVisible = true;
  state.writes = [];
  state.compensated = [];
  state.nextId = 200;
  state.userInsertFails = false;
  state.coachInsertFails = false;
  state.resolution = resolved(PLATFORM);
  state.answer = DEBRIEF_JSON;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("api/coach — la carte dans le fil", () => {
  it("ne pose rien quand la requête ne le demande pas", async () => {
    const { POST } = await import("../coach.js");
    const body = await bodyOf(await POST(coachRequest({ match_id: MATCH_ID })));

    expect(body.debrief).toMatchObject({ id: DEBRIEF_ID });
    expect(body.thread).toBeUndefined();
    expect(state.writes).toEqual([]);
  });

  it("ne pose rien non plus pour un collage manuel sans `thread`", async () => {
    const { POST } = await import("../coach.js");

    await POST(coachRequest({ stats: "Ascent · Jett · 18/14/5" }));

    expect(state.writes).toEqual([]);
  });

  it("pose la question sous le JWT et la carte sous la service key", async () => {
    const { POST } = await import("../coach.js");
    const body = await bodyOf(await POST(coachRequest({ match_id: MATCH_ID, thread: true })));

    expect(state.writes).toEqual([
      { via: "jwt", row: { user_id: USER, role: "user", content: "Analyse ce match." } },
      {
        via: "service",
        row: { user_id: USER, role: "coach", content: RESUME, debrief_id: DEBRIEF_ID },
      },
    ]);
    // Les deux messages reviennent au client : il ne peut plus les écrire, donc
    // il ne peut pas non plus les deviner.
    expect(body.thread).toEqual([
      expect.objectContaining({ role: "user", debriefId: null }),
      expect.objectContaining({ role: "coach", debriefId: DEBRIEF_ID, content: RESUME }),
    ]);
  });

  it("écrit le libellé de la demande côté serveur, jamais reçu du client", async () => {
    const { POST } = await import("../coach.js");

    await POST(
      coachRequest({ stats: "Ascent · Jett · 18/14/5", thread: true, content: "n'importe quoi" }),
    );

    expect(state.writes[0]?.row.content).toBe("Analyse cette partie.");
  });

  it("refuse de référencer un debrief que la RLS ne montre pas à l'appelant", async () => {
    // La policy de la 0014 faisait cette vérification ; la service key la
    // contourne, donc la fonction la refait — sous le client de l'appelant.
    const { POST } = await import("../coach.js");

    state.debriefVisible = false;

    const body = await bodyOf(await POST(coachRequest({ match_id: MATCH_ID, thread: true })));

    expect(state.writes).toEqual([]);
    expect(body.thread).toBeUndefined();
    // Le debrief, lui, est rendu : il est généré, enregistré et facturé.
    expect(body.debrief).toMatchObject({ id: DEBRIEF_ID });
  });

  it("rend le debrief même quand la carte échoue — il est déjà payé", async () => {
    const { POST } = await import("../coach.js");

    state.coachInsertFails = true;

    const response = await POST(coachRequest({ match_id: MATCH_ID, thread: true }));
    const body = await bodyOf(response);

    expect(response.status).toBe(200);
    expect(body.debrief).toMatchObject({ id: DEBRIEF_ID });
    expect(body.thread).toBeUndefined();
  });

  it("retire la question restée seule quand la carte ne suit pas", async () => {
    const { POST } = await import("../coach.js");

    state.coachInsertFails = true;

    await POST(coachRequest({ match_id: MATCH_ID, thread: true }));

    expect(state.compensated).toEqual([200]);
  });
});
