/**
 * Le remboursement du quota, vu depuis les deux fonctions serverless.
 *
 * Ce que les modules purs ne peuvent pas prouver, c'est le **câblage** : que
 * `api/coach` et `api/routine` remboursent sur leurs chemins d'échec, ne
 * remboursent pas sur le chemin heureux, ne remboursent pas ce qui n'a jamais
 * été compté (configuration personnelle) et n'appellent la base qu'une fois par
 * requête. C'est exactement là que vivait l'incident : deux 502 imputables à la
 * configuration de la plateforme ont consommé deux debriefs du quota d'un
 * utilisateur qui n'avait rien reçu.
 *
 * Le fichier vit sous `api/_lib/` — comme `ai-settings.test.ts` — parce que le
 * préfixe `_` sort le dossier du routage Vercel : un fichier de test posé dans
 * `api/` deviendrait une route sans gestionnaire.
 *
 * Trois modules seulement sont remplacés, et ce sont les trois qui sortent du
 * processus : le client Supabase, le client de service, et l'aiguillage des
 * fournisseurs (résolution + appel au modèle). Tout le reste — quota, police de
 * scénarios, remboursement, rédaction des erreurs — est le vrai code.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfig, Resolution } from "../../src/server/ai/index.js";
import { AI_MAX_DURATION_S, AI_MODEL_CALL_CAP_MS } from "../../src/shared/ai-timing.js";

/* ------------------------------------------------------------------ */
/* Les doublures                                                       */
/* ------------------------------------------------------------------ */

const USER = "utilisateur-1";

interface Rpc {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

const state = vi.hoisted(() => ({
  /** Le compteur rendu par `increment_ai_usage`. */
  incremented: 2,
  /** Le compteur rendu par `refund_ai_usage`. */
  refunded: 1,
  /** Panne du remboursement : la base refuse. */
  refundFails: false,
  /** Les appels `rpc` reçus par le client de service. */
  rpcs: [] as Rpc[],
  /** Ce que la résolution du fournisseur rend. */
  resolution: null as unknown,
  /** Les réponses successives du modèle ; une fonction peut lever. */
  answers: [] as (string | (() => never))[],
  /** Le nombre d'appels au modèle. */
  asked: 0,
  /** Les délais accordés à chaque tentative : c'est le budget qui les décide. */
  timeouts: [] as number[],
  /** Le temps que chaque tentative fait passer à l'horloge (budget). */
  spendMs: 0,
  /** L'écriture en base a-t-elle réussi ? */
  insertFails: false,
}));

/** Une chaîne PostgREST : tout enchaîne, tout finit sur le même résultat. */
class Chain implements PromiseLike<{ data: unknown; error: unknown }> {
  constructor(private readonly result: { data: unknown; error: unknown }) {}

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
    return Promise.resolve(this.result);
  }
  single(): Promise<{ data: unknown; error: unknown }> {
    return Promise.resolve(this.result);
  }
  // biome-ignore lint/suspicious/noThenProperty: imite le constructeur de requête de PostgREST, qui est une promesse.
  then<A, B = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: USER } }, error: null }),
    },
    from: () => ({
      // Aucun profil, aucun bench, aucun debrief : le contexte est facultatif,
      // et ce n'est pas lui qu'on teste ici.
      select: () => new Chain({ data: null, error: null }),
      insert: () =>
        new Chain(
          state.insertFails
            ? { data: null, error: { message: "insertion refusée" } }
            : { data: { id: "1", date: "2026-08-09T12:00:00.000Z", done: false }, error: null },
        ),
    }),
  }),
}));

vi.mock("./service.js", () => ({
  serviceClient: () => ({
    from: () => ({ select: () => new Chain({ data: null, error: null }) }),
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcs.push({ name, args });
      switch (name) {
        case "increment_ai_usage":
          return Promise.resolve({ data: state.incremented, error: null });
        case "refund_ai_usage":
          return state.refundFails
            ? Promise.resolve({ data: null, error: { message: "permission denied" } })
            : Promise.resolve({ data: state.refunded, error: null });
        default:
          // `platform_ai_usage_today` : la plateforme n'a rien consommé.
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
    createAsk: () => (_messages: unknown, timeoutMs: number) => {
      const answer = state.answers[state.asked] ?? "";

      state.asked += 1;
      state.timeouts.push(timeoutMs);
      // L'horloge avance comme si l'appel avait duré : c'est la seule façon de
      // voir le budget se consommer sans faire attendre le test.
      if (state.spendMs > 0) vi.setSystemTime(Date.now() + state.spendMs);
      if (typeof answer === "function") return Promise.resolve().then(answer);
      return Promise.resolve({ text: answer, truncated: false });
    },
  };
});

/* ------------------------------------------------------------------ */
/* Le décor                                                            */
/* ------------------------------------------------------------------ */

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

const DEBRIEF = JSON.stringify({
  resume: "Partie serrée, perdue sur les retakes.",
  points_forts: ["Entrées propres sur A"],
  axes: [{ titre: "Retakes", detail: "Entrez groupés après la pose." }],
  focus: "Viseur à hauteur de tête.",
});

const ROUTINE = JSON.stringify({
  titre: "Séance tracking",
  duree_totale: 30,
  blocs: [
    {
      nom: "Échauffement",
      duree: 30,
      items: [{ texte: "VT Pasu Novice", detail: "3 runs de 60 s, sans forcer." }],
    },
  ],
  objectif_game: "Garde le viseur à hauteur de tête sur les angles.",
  conseil: "Respire entre les runs.",
});

function coachRequest(): Request {
  return new Request("https://aimforge.test/api/coach", {
    method: "POST",
    headers: { authorization: "Bearer jeton", "content-type": "application/json" },
    body: JSON.stringify({ stats: "Ascent · Jett · 18/14/5" }),
  });
}

function routineRequest(): Request {
  return new Request("https://aimforge.test/api/routine", {
    method: "POST",
    headers: { authorization: "Bearer jeton", "content-type": "application/json" },
    body: JSON.stringify({ duree_minutes: 30, focus: null }),
  });
}

/** Les remboursements demandés à la base pendant la requête. */
function refunds(): Rpc[] {
  return state.rpcs.filter((call) => call.name === "refund_ai_usage");
}

function increments(): Rpc[] {
  return state.rpcs.filter((call) => call.name === "increment_ai_usage");
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

/** Un modèle en panne : le cas exact de l'incident (clé de plateforme refusée). */
function unreachable(): () => never {
  return () => {
    throw new Error("réseau injoignable");
  };
}

beforeEach(() => {
  state.incremented = 2;
  state.refunded = 1;
  state.refundFails = false;
  state.rpcs = [];
  state.resolution = resolved(PLATFORM);
  state.answers = [];
  state.asked = 0;
  state.timeouts = [];
  state.spendMs = 0;
  state.insertFails = false;
  // Seule `Date` est truquée : les promesses et les délais réels continuent de
  // tourner, on ne veut piloter que le budget.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Coach                                                               */
/* ------------------------------------------------------------------ */

describe("api/coach — remboursement du quota", () => {
  it("rembourse quand le modèle est injoignable, et annonce le quota rendu", async () => {
    state.answers = [unreachable(), unreachable()];

    const { POST } = await import("../coach.js");
    const response = await POST(coachRequest());

    expect(response.status).toBe(502);
    expect(refunds()).toEqual([
      { name: "refund_ai_usage", args: { p_user_id: USER, p_kind: "coach" } },
    ]);
    // Limite 5, compteur 2 après incrément (3 restants), 1 après remboursement :
    // le client doit lire 4, l'état d'APRÈS remboursement.
    expect(await bodyOf(response)).toEqual({
      error: expect.stringContaining("injoignable"),
      remaining: 4,
    });
  });

  it("rembourse une sortie hors contrat, même après relance — une seule fois", async () => {
    state.answers = ["pas du JSON", "toujours pas du JSON"];

    const { POST } = await import("../coach.js");
    const response = await POST(coachRequest());

    expect(response.status).toBe(502);
    expect(state.asked).toBe(2);
    expect(refunds()).toHaveLength(1);
    expect((await bodyOf(response)).remaining).toBe(4);
  });

  it("rembourse un debrief qui invente des scénarios : rien n'a été rendu au joueur", async () => {
    const invented = JSON.stringify({
      resume: "Partie serrée.",
      points_forts: ["Entrées propres"],
      axes: [{ titre: "Tracking", detail: "Fais 3 runs de VT Reactive Tracking." }],
      focus: "Viseur à hauteur de tête.",
    });

    state.answers = [invented, invented];

    const { POST } = await import("../coach.js");
    const response = await POST(coachRequest());

    expect(response.status).toBe(502);
    expect(refunds()).toHaveLength(1);
  });

  it("ne rembourse rien quand le debrief est produit et enregistré", async () => {
    state.answers = [DEBRIEF];

    const { POST } = await import("../coach.js");
    const response = await POST(coachRequest());

    expect(response.status).toBe(200);
    expect(refunds()).toEqual([]);
    expect((await bodyOf(response)).remaining).toBe(3);
  });

  it("rembourse quand le debrief est généré mais pas enregistré", async () => {
    state.answers = [DEBRIEF];
    state.insertFails = true;

    const { POST } = await import("../coach.js");
    const response = await POST(coachRequest());

    expect(response.status).toBe(500);
    expect(refunds()).toHaveLength(1);
    expect(await bodyOf(response)).toEqual({
      error: expect.stringContaining("n'a pas été décompté"),
      remaining: 4,
    });
  });

  it("ne rembourse rien sur une configuration personnelle : rien n'a été compté", async () => {
    state.resolution = resolved(PERSONAL);
    state.answers = [unreachable(), unreachable()];

    const { POST } = await import("../coach.js");
    const response = await POST(coachRequest());

    expect(increments()).toEqual([]);
    expect(refunds()).toEqual([]);
    // Pas de `remaining` du tout : le contrat d'erreur ne l'accepte pas nul, et
    // il n'y a de toute façon rien à annoncer.
    expect(await bodyOf(response)).not.toHaveProperty("remaining");
  });

  it("ne rembourse pas le refus de quota lui-même : le 429 n'est pas une panne", async () => {
    state.incremented = 6;

    const { POST } = await import("../coach.js");
    const response = await POST(coachRequest());

    expect(response.status).toBe(429);
    expect(refunds()).toEqual([]);
    expect(state.asked).toBe(0);
  });

  it("ne rembourse pas une entrée invalide : elle n'atteint jamais le compteur", async () => {
    const { POST } = await import("../coach.js");
    const response = await POST(
      new Request("https://aimforge.test/api/coach", {
        method: "POST",
        headers: { authorization: "Bearer jeton" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    expect(state.rpcs).toEqual([]);
  });

  it("borne chaque tentative par le budget, et non par un délai fixe", async () => {
    // Avant V4-C, `api/coach` accordait 45 s à chaque appel : deux appels lents
    // faisaient 90 s sous un `maxDuration` de 60 s, donc une fonction tuée par
    // la plateforme — sans réponse rédigée et **sans remboursement**.
    state.answers = ["pas du JSON", "toujours pas du JSON"];

    const { POST } = await import("../coach.js");

    await POST(coachRequest());
    expect(state.timeouts).toHaveLength(2);
    expect(state.timeouts[0]).toBe(AI_MODEL_CALL_CAP_MS);
    for (const timeout of state.timeouts) {
      expect(timeout).toBeLessThan(AI_MAX_DURATION_S * 1_000);
    }
  });

  it("renonce et rembourse quand le budget ne permet plus de relancer", async () => {
    // Le premier appel consomme presque tout le budget et rend une sortie hors
    // contrat : la relance n'a plus de quoi aboutir. On préfère un 504 rédigé,
    // quota rendu, à une coupure de plateforme qui ne rembourse rien.
    state.spendMs = 41_000;
    state.answers = ["pas du JSON", DEBRIEF];

    const { POST } = await import("../coach.js");
    const response = await POST(coachRequest());

    expect(response.status).toBe(504);
    expect(state.asked).toBe(1);
    expect(refunds()).toHaveLength(1);
    expect(await bodyOf(response)).toEqual({
      error: expect.stringContaining("trop de temps"),
      remaining: 4,
    });
  });

  it("laisse l'erreur d'origine intacte quand le remboursement échoue à son tour", async () => {
    state.refundFails = true;
    state.answers = [unreachable(), unreachable()];

    const { POST } = await import("../coach.js");
    const response = await POST(coachRequest());

    // Ni statut différent, ni message masqué : seul le quota annoncé reste
    // celui d'avant, puisque la base n'a rien rendu.
    expect(response.status).toBe(502);
    expect((await bodyOf(response)).remaining).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
/* Routine                                                             */
/* ------------------------------------------------------------------ */

describe("api/routine — remboursement du quota", () => {
  it("rembourse quand le modèle est injoignable, et annonce le quota rendu", async () => {
    state.answers = [unreachable(), unreachable()];

    const { POST } = await import("../routine.js");
    const response = await POST(routineRequest());

    expect(response.status).toBe(502);
    expect(refunds()).toEqual([
      { name: "refund_ai_usage", args: { p_user_id: USER, p_kind: "routine" } },
    ]);
    expect((await bodyOf(response)).remaining).toBe(4);
  });

  it("rembourse une sortie hors contrat, une seule fois", async () => {
    state.answers = ["pas du JSON", "toujours pas du JSON"];

    const { POST } = await import("../routine.js");
    const response = await POST(routineRequest());

    expect(response.status).toBe(502);
    expect(refunds()).toHaveLength(1);
  });

  it("ne rembourse rien quand la routine est produite et enregistrée", async () => {
    state.answers = [ROUTINE];

    const { POST } = await import("../routine.js");
    const response = await POST(routineRequest());

    expect(response.status).toBe(200);
    expect(refunds()).toEqual([]);
    expect((await bodyOf(response)).remaining).toBe(3);
  });

  it("rembourse quand la routine est générée mais pas enregistrée", async () => {
    state.answers = [ROUTINE];
    state.insertFails = true;

    const { POST } = await import("../routine.js");
    const response = await POST(routineRequest());

    expect(response.status).toBe(500);
    expect(refunds()).toHaveLength(1);
    expect((await bodyOf(response)).remaining).toBe(4);
  });

  it("ne rembourse rien sur une configuration personnelle", async () => {
    state.resolution = resolved(PERSONAL);
    state.answers = [unreachable(), unreachable()];

    const { POST } = await import("../routine.js");

    await POST(routineRequest());
    expect(increments()).toEqual([]);
    expect(refunds()).toEqual([]);
  });

  it("renonce et rembourse quand le budget ne permet plus de relancer", async () => {
    state.spendMs = 41_000;
    state.answers = ["pas du JSON", ROUTINE];

    const { POST } = await import("../routine.js");
    const response = await POST(routineRequest());

    expect(response.status).toBe(504);
    expect(state.asked).toBe(1);
    expect(refunds()).toHaveLength(1);
    expect((await bodyOf(response)).remaining).toBe(4);
  });
});
