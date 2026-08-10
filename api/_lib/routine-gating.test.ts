/**
 * `api/routine` vu depuis la fonction serverless : le gating à cinq parties et
 * la police des citations (SPEC §5 sexies, V5).
 *
 * Les décisions elles-mêmes sont prouvées sans base, en modules purs
 * (`src/server/routine/gating.test.ts`, `citations.test.ts`). Ce qui se prouve
 * ici est le **câblage**, c'est-à-dire tout ce qu'un module pur ne peut pas
 * voir : que le compte de parties vient de la base et non du navigateur, que le
 * mode « bench seul » retire vraiment les stats du prompt, que le mode et le
 * compte partent dans la ligne enregistrée, et qu'une citation fausse suit le
 * chemin d'un scénario inventé — une relance, puis un 502 remboursé.
 *
 * Sous `api/_lib/` comme les autres : le préfixe `_` sort le dossier du routage
 * Vercel, un fichier de test posé dans `api/` deviendrait une route sans
 * gestionnaire.
 *
 * Trois modules seulement sont remplacés, et ce sont les trois qui sortent du
 * processus : le client Supabase, le client de service, et l'aiguillage des
 * fournisseurs. Le reste — lecture du corps, gating, prompt, police des
 * scénarios et des citations, quota — est le vrai code.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig, Resolution } from "../../src/server/ai/index.js";
import { ROUTINE_MIN_RECENT_MATCHES } from "../../src/shared/routine-contract.js";

const USER = "utilisateur-1";

const DAY_MS = 86_400_000;

interface Rpc {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

interface Insert {
  readonly table: string;
  readonly values: unknown;
}

const state = vi.hoisted(() => ({
  /** Le compte Riot principal visible par l'appelant. */
  account: { id: 7 } as unknown,
  /** Les lignes de `imported_matches` (RLS déjà appliquée). */
  matches: [] as unknown[],
  rpcs: [] as Rpc[],
  inserts: [] as Insert[],
  resolution: null as unknown,
  answers: [] as string[],
  asked: 0,
  /** Les conversations envoyées au modèle, pour relire le prompt. */
  prompts: [] as string[],
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
        if (table === "linked_accounts") return new Chain([], state.account);
        if (table === "imported_matches") return new Chain(state.matches);
        // Bench et debriefs : absents, ce n'est pas ce qu'on teste ici.
        return new Chain([], null);
      },
      insert: (values: unknown) => {
        state.inserts.push({ table, values });
        return new Chain(null, { id: 12, date: "2026-08-10T19:00:00.000Z", done: false });
      },
    }),
  }),
}));

vi.mock("./service.js", () => ({
  serviceClient: () => ({
    from: () => ({ select: () => new Chain([], null) }),
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      state.rpcs.push({ name, args });
      switch (name) {
        case "increment_ai_usage":
          return Promise.resolve({ data: 2, error: null });
        case "refund_ai_usage":
          return Promise.resolve({ data: 1, error: null });
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
    createAsk: () => (messages: readonly { readonly content: string }[]) => {
      state.prompts.push(messages.map((entry) => entry.content).join("\n"));

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

const ROUTINE = {
  titre: "Séance 45 min",
  duree_totale: 45,
  blocs: [
    {
      nom: "Travail ciblé",
      duree: 45,
      items: [{ texte: "Échauffement libre", detail: "Cinq minutes, sans forcer." }],
    },
  ],
  objectif_game: "Un duel gagné par round sur l'entrée.",
  conseil: "Coupe le chat vocal.",
};

/** La même routine, avec un marqueur chiffré dans le conseil. */
function withCitation(marker: string): string {
  return JSON.stringify({ ...ROUTINE, conseil: `Coupe le chat vocal, ton ${marker} le dit.` });
}

/** Une partie classée jouée il y a `daysAgo` jours, telle que la base la stocke. */
function match(index: number, daysAgo: number): { readonly payload: unknown } {
  return {
    payload: {
      matchId: `match-${index}`,
      playedAt: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
      map: "Ascent",
      mode: "Compétitif",
      agent: "Jett",
      kills: 20,
      deaths: 10,
      assists: 4,
      adr: 150,
      headshotPercent: 20,
      roundsWon: 13,
      roundsLost: 11,
      result: "victoire",
    },
  };
}

function recent(count: number, daysAgo = 2): { readonly payload: unknown }[] {
  return Array.from({ length: count }, (_, index) => match(index, daysAgo));
}

function routineRequest(body: unknown, authenticated = true): Request {
  return new Request("https://aimforge.test/api/routine", {
    method: "POST",
    headers: authenticated
      ? { authorization: "Bearer jeton", "content-type": "application/json" }
      : { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

function routineInsert(): Record<string, unknown> | null {
  const insert = state.inserts.find((entry) => entry.table === "routines") ?? null;

  return insert === null ? null : (insert.values as Record<string, unknown>);
}

function storedContent(): Record<string, unknown> {
  return (routineInsert()?.contenu ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  state.account = { id: 7 };
  state.matches = [];
  state.rpcs = [];
  state.inserts = [];
  state.resolution = resolved(PLATFORM);
  state.answers = [JSON.stringify(ROUTINE)];
  state.asked = 0;
  state.prompts = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("api/routine — identité et entrée", () => {
  it("refuse un appel sans jeton, avant toute lecture", async () => {
    const { POST } = await import("../routine.js");
    const response = await POST(routineRequest({ duree_minutes: 45 }, false));

    expect(response.status).toBe(401);
    expect(state.rpcs).toEqual([]);
    expect(state.asked).toBe(0);
  });

  it("refuse une durée hors bornes sans rien consommer", async () => {
    const { POST } = await import("../routine.js");
    const response = await POST(routineRequest({ duree_minutes: 5 }));

    expect(response.status).toBe(400);
    expect(state.rpcs).toEqual([]);
    expect(state.asked).toBe(0);
  });
});

describe("api/routine — gating à cinq parties récentes", () => {
  it("génère quand même sans aucune partie, en mode bench seul", async () => {
    const { POST } = await import("../routine.js");
    const response = await POST(routineRequest({ duree_minutes: 45 }));

    expect(response.status).toBe(200);

    const routine = (await bodyOf(response)).routine as Record<string, unknown>;

    expect(routine.mode).toBe("bench_only");
    expect(routine.matchesUsed).toBe(0);
    // Le mode part en base : l'historique doit pouvoir réafficher le bandeau.
    expect(storedContent().mode).toBe("bench_only");
  });

  it("reste en bench seul à une partie du seuil", async () => {
    state.matches = recent(ROUTINE_MIN_RECENT_MATCHES - 1);

    const { POST } = await import("../routine.js");
    const routine = ((await bodyOf(await POST(routineRequest({ duree_minutes: 45 })))).routine ??
      {}) as Record<string, unknown>;

    expect(routine.mode).toBe("bench_only");
    expect(routine.matchesUsed).toBe(4);
  });

  it("ne montre aucune statistique de partie au modèle en mode bench seul", async () => {
    const { POST } = await import("../routine.js");

    await POST(routineRequest({ duree_minutes: 45 }));

    expect(state.prompts[0]).toContain("Aucune statistique de partie disponible");
    expect(state.prompts[0]).not.toContain("Winrate :");
    expect(state.prompts[0]).toContain("Aucun chiffre citable");
  });

  it("passe en mode complet au seuil, et montre les agrégats au modèle", async () => {
    state.matches = recent(ROUTINE_MIN_RECENT_MATCHES);
    state.answers = [withCitation("[HS% 20]")];

    const { POST } = await import("../routine.js");
    const response = await POST(routineRequest({ duree_minutes: 45 }));

    expect(response.status).toBe(200);

    const routine = (await bodyOf(response)).routine as Record<string, unknown>;

    expect(routine.mode).toBe("full");
    expect(routine.matchesUsed).toBe(5);
    expect(state.prompts[0]).toContain("5 parties classées");
    expect(state.prompts[0]).toContain("Tirs à la tête : 20 %");
    expect(state.prompts[0]).toContain("[HS% 20]");
  });

  it("écarte les parties trop anciennes : la fenêtre est glissante", async () => {
    state.matches = recent(ROUTINE_MIN_RECENT_MATCHES, 40);

    const { POST } = await import("../routine.js");
    const routine = ((await bodyOf(await POST(routineRequest({ duree_minutes: 45 })))).routine ??
      {}) as Record<string, unknown>;

    expect(routine.mode).toBe("bench_only");
    expect(routine.matchesUsed).toBe(0);
  });

  it("dégrade en bench seul plutôt que d'échouer quand les matchs sont illisibles", async () => {
    state.matches = [{ payload: { map: "Ascent" } }];

    const { POST } = await import("../routine.js");
    const response = await POST(routineRequest({ duree_minutes: 45 }));

    expect(response.status).toBe(200);
    expect(storedContent().mode).toBe("bench_only");
  });
});

describe("api/routine — police des citations", () => {
  beforeEach(() => {
    state.matches = recent(ROUTINE_MIN_RECENT_MATCHES);
  });

  it("retire les marqueurs vérifiés du texte et les rend en sources", async () => {
    state.answers = [withCitation("[HS% 20]")];

    const { POST } = await import("../routine.js");
    const routine = ((await bodyOf(await POST(routineRequest({ duree_minutes: 45 })))).routine ??
      {}) as Record<string, unknown>;

    expect(routine.conseil).toBe("Coupe le chat vocal, ton le dit.");
    expect(routine.sources).toEqual([
      { label: "Tirs à la tête (30 derniers jours)", value: "20 %" },
    ]);
  });

  it("relance une fois sur un chiffre inventé, puis garde la réponse corrigée", async () => {
    state.answers = [withCitation("[HS% 62]"), withCitation("[HS% 20]")];

    const { POST } = await import("../routine.js");
    const response = await POST(routineRequest({ duree_minutes: 45 }));

    expect(response.status).toBe(200);
    expect(state.asked).toBe(2);
    expect(state.prompts[1]).toContain("[HS% 62]");
  });

  it("rend 502 et rembourse le quota quand la relance ment encore", async () => {
    state.answers = [withCitation("[HS% 62]"), withCitation("[HS% 62]")];

    const { POST } = await import("../routine.js");
    const response = await POST(routineRequest({ duree_minutes: 45 }));

    expect(response.status).toBe(502);
    expect(state.asked).toBe(2);
    expect(state.inserts).toEqual([]);
    expect(state.rpcs.filter((call) => call.name === "refund_ai_usage")).toHaveLength(1);
  });
});
