/**
 * Le quota joint à `GET /api/ai-settings`, vu depuis la fonction serverless.
 *
 * Les modules purs prouvent l'arithmétique (`ai-quota-contract.test.ts`) et la
 * lecture des compteurs (`ai-quota.test.ts`). Ce qu'aucun des deux ne peut
 * prouver, c'est le **câblage**, et c'est là que vivait le défaut d'origine :
 * l'écran annonçait « 5 routines par jour » en recopiant une constante du
 * bundle, alors que `platform_settings` peut dire 3. Les cas ci-dessous fixent
 * les deux promesses qui réparent ça :
 *
 * 1. la limite servie est celle **réglée en base**, pas la constante ;
 * 2. `lifted` suit la configuration personnelle, sans seconde lecture.
 *
 * Le fichier vit sous `api/_lib/` — comme `quota-refund.test.ts` — parce que le
 * préfixe `_` sort le dossier du routage Vercel : un fichier de test posé dans
 * `api/` deviendrait une route sans gestionnaire.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiSettingsViewSchema } from "../../src/shared/ai-settings-contract.js";

const USER = "utilisateur-1";

const state = vi.hoisted(() => ({
  /** La ligne `ai_settings` de l'utilisateur, ou `null` s'il n'en a pas. */
  settings: null as Record<string, unknown> | null,
  /** La ligne `ai_usage` du jour, ou `null` si rien n'a été consommé. */
  usage: null as Record<string, unknown> | null,
  /** Les quotas enregistrés dans `platform_settings`. */
  coachDaily: 5,
  routineDaily: 5,
  /** Les tables lues avec le JWT de l'appelant, et leurs filtres. */
  reads: [] as { table: string; filters: Record<string, unknown> }[],
}));

/** Une chaîne PostgREST minimale, qui enregistre la table et les filtres. */
function chain(table: string, result: unknown) {
  const filters: Record<string, unknown> = {};

  state.reads.push({ table, filters });

  const api = {
    select: () => api,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return api;
    },
    maybeSingle: () => Promise.resolve({ data: result, error: null }),
  };

  return api;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: USER } }, error: null }) },
    from: (table: string) => chain(table, table === "ai_settings" ? state.settings : state.usage),
  }),
}));

vi.mock("./service.js", () => ({
  serviceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: {
                ai_provider: null,
                ai_model: null,
                ai_base_url: null,
                ai_api_key: null,
                henrikdev_api_key: null,
                coach_daily: state.coachDaily,
                routine_daily: state.routineDaily,
                kovaaks_import_daily: 20,
                riot_link_daily: 5,
                ai_global_daily_limit: null,
                updated_at: "2026-08-12T08:00:00.000Z",
              },
              error: null,
            }),
        }),
      }),
    }),
  }),
}));

const { GET } = await import("../ai-settings.js");

function request(): Request {
  return new Request("https://aimforge.test/api/ai-settings", {
    headers: { authorization: "Bearer jeton" },
  });
}

async function view() {
  const response = await GET(request());

  expect(response.status).toBe(200);
  return aiSettingsViewSchema.parse(await response.json());
}

beforeEach(() => {
  state.settings = null;
  state.usage = null;
  state.coachDaily = 5;
  state.routineDaily = 5;
  state.reads = [];
});

describe("GET /api/ai-settings — le quota joint", () => {
  it("sert la limite réglée en base, et non la constante du bundle", async () => {
    state.coachDaily = 3;
    state.routineDaily = 7;

    const { quota } = await view();

    expect(quota.quotas).toEqual([
      { kind: "coach", used: 0, limit: 3, resetAt: expect.any(String) },
      { kind: "routine", used: 0, limit: 7, resetAt: expect.any(String) },
      // Le chat n'a pas de colonne dans `platform_settings` : sa limite reste
      // la constante de son contrat, et c'est assumé là-bas.
      { kind: "chat", used: 0, limit: 20, resetAt: expect.any(String) },
    ]);
  });

  it("rapporte les compteurs du jour de l'appelant", async () => {
    state.usage = { coach_count: 2, routine_count: 1, chat_count: 9 };

    const { quota } = await view();

    expect(quota.quotas.map((entry) => entry.used)).toEqual([2, 1, 9]);
  });

  it("lit la ligne d'usage du jour UTC, pour cet utilisateur et lui seul", async () => {
    await view();

    const usage = state.reads.find((read) => read.table === "ai_usage");

    expect(usage?.filters.user_id).toBe(USER);
    expect(usage?.filters.day).toBe(new Date().toISOString().slice(0, 10));
  });

  it("annonce le prochain minuit UTC, pas une heure devinée", async () => {
    const { quota } = await view();
    const resetAt = quota.quotas[0]?.resetAt ?? "";

    expect(resetAt).toMatch(/T00:00:00\.000Z$/);
    expect(Date.parse(resetAt)).toBeGreaterThan(Date.now());
  });

  it("ne lève pas le quota quand l'utilisateur n'a pas de configuration", async () => {
    const { quota, settings } = await view();

    expect(settings).toBeNull();
    expect(quota.lifted).toBe(false);
  });

  it("lève le quota dès qu'une configuration personnelle exploitable existe", async () => {
    state.settings = {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      base_url: null,
      updated_at: "2026-08-12T09:00:00.000Z",
    };

    const { quota, settings } = await view();

    expect(settings?.provider).toBe("anthropic");
    expect(quota.lifted).toBe(true);
  });

  it("ne relit pas les réglages pour répondre « levé » : une seule lecture", async () => {
    state.settings = {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      base_url: null,
      updated_at: "2026-08-12T09:00:00.000Z",
    };

    await view();

    expect(state.reads.filter((read) => read.table === "ai_settings")).toHaveLength(1);
  });
});
