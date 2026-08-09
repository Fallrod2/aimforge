/**
 * Le chat coach (SPEC §5 ter bis), vu depuis la fonction serverless.
 *
 * Ce que les modules purs ne peuvent pas prouver, c'est le **câblage** :
 * l'ordre des contrôles (401 → 400 → 404 → 503 → quota), le compteur `chat`
 * plutôt que `coach`, le remboursement sur les chemins d'échec — et la règle
 * qui n'existe que sur ce chemin : **rien n'est persisté quand la génération
 * échoue**, le message de l'utilisateur compris. Une conversation trouée se
 * relirait comme un tour que le coach aurait ignoré, et repartirait au modèle
 * dans cet état au tour suivant.
 *
 * Trois modules seulement sont remplacés, et ce sont les trois qui sortent du
 * processus : le client Supabase, le client de service, et l'aiguillage des
 * fournisseurs. Le reste — validation, police de scénarios, quota — est le vrai
 * code.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig, Resolution } from "../../src/server/ai/index.js";

const USER = "utilisateur-1";

const DEBRIEF_ID = 3;

/** Le debrief dont on discute, tel que la base le rend. */
const DEBRIEF_ROW = {
  id: DEBRIEF_ID,
  date: "2026-08-09T19:00:00.000Z",
  resume: "Partie serrée, perdue sur les retakes.",
  points_forts: ["Entrées propres sur A"],
  axes: [{ titre: "Retakes", detail: "Entrez groupés après la pose." }],
  focus: "Viseur à hauteur de tête.",
};

interface Rpc {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

const state = vi.hoisted(() => ({
  /** Le debrief visible par l'appelant (RLS déjà appliquée), ou `null`. */
  debrief: null as unknown,
  /** La conversation déjà enregistrée, du plus récent au plus ancien. */
  history: [] as unknown[],
  /** La service key est-elle posée ? */
  serviceReady: true,
  incremented: 2,
  refunded: 1,
  rpcs: [] as Rpc[],
  /** Les lignes insérées dans `coach_messages`. */
  inserted: [] as unknown[],
  insertFails: false,
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

/** Les lignes rendues par l'insertion, dans l'ordre où elles ont été posées. */
function insertedRows(values: readonly Record<string, unknown>[]): unknown[] {
  return values.map((value, index) => ({
    id: 100 + index,
    debrief_id: value.debrief_id,
    role: value.role,
    content: value.content,
    created_at: "2026-08-09T19:05:00.000Z",
  }));
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
      select: () => {
        if (table === "debriefs") return new Chain([], state.debrief);
        if (table === "coach_messages") return new Chain(state.history);
        // Profil et bench : absents, ce n'est pas ce qu'on teste ici.
        return new Chain([], null);
      },
      insert: (values: readonly Record<string, unknown>[]) => {
        if (state.insertFails) return new Chain(null, null, { message: "insertion refusée" });
        state.inserted = [...state.inserted, ...values];
        return new Chain(insertedRows(values));
      },
    }),
  }),
}));

vi.mock("./service.js", () => ({
  serviceClient: () =>
    state.serviceReady
      ? {
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

const ANSWER = "Reprends les retakes : entrez à trois, un flash, personne n'entre seul.";

function chatRequest(
  body: Record<string, unknown> = { debrief_id: DEBRIEF_ID, message: "Que faire pour l'axe 1 ?" },
  token = "jeton",
): Request {
  return new Request("https://aimforge.test/api/coach-chat", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function anonymousRequest(): Request {
  return new Request("https://aimforge.test/api/coach-chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ debrief_id: DEBRIEF_ID, message: "Coucou" }),
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
  state.debrief = DEBRIEF_ROW;
  state.history = [];
  state.serviceReady = true;
  state.incremented = 2;
  state.refunded = 1;
  state.rpcs = [];
  state.inserted = [];
  state.insertFails = false;
  state.resolution = resolved(PLATFORM);
  state.answers = [ANSWER];
  state.asked = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("api/coach-chat — ordre des contrôles", () => {
  it("refuse un appel anonyme avant tout le reste", async () => {
    state.serviceReady = false;

    const { POST } = await import("../coach-chat.js");
    const response = await POST(anonymousRequest());

    // 401 même quand l'IA n'est pas configurée : la fonction n'annonce pas son
    // état de configuration à n'importe qui.
    expect(response.status).toBe(401);
    expect(state.asked).toBe(0);
  });

  it("refuse un message vide ou démesuré", async () => {
    const { POST } = await import("../coach-chat.js");

    expect((await POST(chatRequest({ debrief_id: DEBRIEF_ID, message: "   " }))).status).toBe(400);
    expect(
      (await POST(chatRequest({ debrief_id: DEBRIEF_ID, message: "x".repeat(2001) }))).status,
    ).toBe(400);
    expect((await POST(chatRequest({ message: "Salut" }))).status).toBe(400);
    expect(state.rpcs).toEqual([]);
  });

  it("répond 404 sur un debrief invisible, même IA non configurée", async () => {
    // La RLS ne rend rien : debrief supprimé ou debrief de quelqu'un d'autre —
    // indiscernables. Et l'appartenance passe avant la configuration, sinon un
    // identifiant qui n'est pas le sien renseignerait sur l'état du service.
    state.debrief = null;
    state.serviceReady = false;

    const { POST } = await import("../coach-chat.js");
    const response = await POST(chatRequest());

    expect(response.status).toBe(404);
    expect(state.asked).toBe(0);
  });

  it("répond 503 quand l'IA n'est pas configurée mais que le debrief est bien le sien", async () => {
    state.serviceReady = false;

    const { POST } = await import("../coach-chat.js");
    const response = await POST(chatRequest());

    expect(response.status).toBe(503);
  });

  it("refuse un debrief dont le contenu ne respecte plus le contrat", async () => {
    state.debrief = { ...DEBRIEF_ROW, axes: "des retakes" };

    const { POST } = await import("../coach-chat.js");
    const response = await POST(chatRequest());

    expect(response.status).toBe(422);
    expect(state.rpcs).toEqual([]);
  });
});

describe("api/coach-chat — quota", () => {
  it("incrémente le compteur `chat`, et pas celui du debrief", async () => {
    const { POST } = await import("../coach-chat.js");
    const response = await POST(chatRequest());

    expect(response.status).toBe(200);
    expect(increments()).toEqual([
      { name: "increment_ai_usage", args: { p_user_id: USER, p_kind: "chat" } },
    ]);
    // Limite 20, compteur 2 après incrément : 18 restants.
    expect((await bodyOf(response)).remaining).toBe(18);
  });

  it("refuse au-delà de la limite, sans appeler le modèle ni rembourser", async () => {
    state.incremented = 21;

    const { POST } = await import("../coach-chat.js");
    const response = await POST(chatRequest());

    expect(response.status).toBe(429);
    expect(state.asked).toBe(0);
    expect(refunds()).toEqual([]);
  });

  it("ne compte rien sur une configuration personnelle", async () => {
    state.resolution = resolved(PERSONAL);

    const { POST } = await import("../coach-chat.js");
    const response = await POST(chatRequest());

    expect(response.status).toBe(200);
    expect(increments()).toEqual([]);
    expect(refunds()).toEqual([]);
    expect((await bodyOf(response)).remaining).toBeNull();
  });
});

describe("api/coach-chat — échecs : rien n'est persisté, le quota est rendu", () => {
  it("rembourse et n'écrit rien quand le modèle est injoignable", async () => {
    state.answers = [unreachable(), unreachable()];

    const { POST } = await import("../coach-chat.js");
    const response = await POST(chatRequest());

    expect(response.status).toBe(502);
    // Le message de l'utilisateur n'est PAS enregistré : pas de conversation
    // trouée, donc pas de tour que le coach aurait l'air d'avoir ignoré.
    expect(state.inserted).toEqual([]);
    expect(refunds()).toHaveLength(1);
    expect((await bodyOf(response)).remaining).toBe(19);
  });

  it("rembourse une réponse qui invente un scénario, même après relance", async () => {
    const invented = "Fais 3 runs de VT Reactive Tracking, tous les jours.";

    state.answers = [invented, invented];

    const { POST } = await import("../coach-chat.js");
    const response = await POST(chatRequest());

    expect(response.status).toBe(502);
    expect(state.asked).toBe(2);
    expect(state.inserted).toEqual([]);
    expect(refunds()).toHaveLength(1);
  });

  it("rembourse quand la réponse est produite mais pas enregistrée", async () => {
    state.insertFails = true;

    const { POST } = await import("../coach-chat.js");
    const response = await POST(chatRequest());

    expect(response.status).toBe(500);
    expect(refunds()).toHaveLength(1);
    expect(await bodyOf(response)).toEqual({
      error: expect.stringContaining("n'a pas été décompté"),
      remaining: 19,
    });
  });
});

describe("api/coach-chat — succès", () => {
  it("enregistre les deux messages ensemble et les rend au client", async () => {
    const { POST } = await import("../coach-chat.js");
    const response = await POST(chatRequest());
    const body = await bodyOf(response);

    expect(state.inserted).toEqual([
      {
        user_id: USER,
        debrief_id: DEBRIEF_ID,
        role: "user",
        content: "Que faire pour l'axe 1 ?",
      },
      { user_id: USER, debrief_id: DEBRIEF_ID, role: "coach", content: ANSWER },
    ]);
    // Les deux reviennent : le message de l'utilisateur n'existe qu'une fois la
    // génération réussie, le navigateur ne peut donc pas l'ajouter lui-même.
    expect(body.question).toMatchObject({ role: "user", content: "Que faire pour l'axe 1 ?" });
    expect(body.answer).toMatchObject({ role: "coach", content: ANSWER });
    expect(refunds()).toEqual([]);
  });

  it("relit la conversation existante sans que cela empêche la réponse", async () => {
    state.history = [
      { role: "coach", content: "Commence par les retakes." },
      { role: "user", content: "Et le tracking ?" },
    ];

    const { POST } = await import("../coach-chat.js");

    expect((await POST(chatRequest())).status).toBe(200);
    expect(state.asked).toBe(1);
  });
});
