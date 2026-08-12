/**
 * La lecture des compteurs du jour, jouée contre une fausse chaîne PostgREST.
 *
 * Ce qui compte ici est la **frontière**, comme dans `ai-usage.test.ts` : la
 * bonne table, les bonnes colonnes, et surtout le bon jour — celui que les
 * fonctions SQL écrivent, `(now() at time zone 'utc')::date`, et pas la date
 * locale de la fonction serverless. Le reste (plafonnement, heure de
 * réinitialisation) appartient au contrat et s'y teste.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { aiQuotaLimits, readAiQuotas } from "./ai-quota.js";

const USER = "utilisateur-1";

const LIMITS = { coach: 5, routine: 5, chat: 20 } as const;

interface Query {
  table: string;
  columns: string;
  filters: Record<string, unknown>;
}

/** Une chaîne PostgREST minimale : elle enregistre ce qu'on lui demande. */
function fakeClient(result: { data: unknown; error: { message: string } | null }): {
  client: SupabaseClient;
  queries: Query[];
} {
  const queries: Query[] = [];
  const client = {
    from(table: string) {
      const query: Query = { table, columns: "", filters: {} };

      queries.push(query);

      const chain = {
        select(columns: string) {
          query.columns = columns;
          return chain;
        },
        eq(column: string, value: unknown) {
          query.filters[column] = value;
          return chain;
        },
        maybeSingle: () => Promise.resolve(result),
      };

      return chain;
    },
  };

  return { client: client as unknown as SupabaseClient, queries };
}

describe("readAiQuotas", () => {
  it("lit la ligne du jour UTC de l'appelant, et ses trois compteurs", async () => {
    const { client, queries } = fakeClient({
      data: { coach_count: 2, routine_count: 1, chat_count: 7 },
      error: null,
    });
    const quotas = await readAiQuotas(client, USER, LIMITS, new Date("2026-08-12T10:00:00.000Z"));

    expect(queries).toEqual([
      {
        table: "ai_usage",
        columns: "coach_count, routine_count, chat_count",
        filters: { user_id: USER, day: "2026-08-12" },
      },
    ]);
    expect(quotas).toEqual([
      { kind: "coach", used: 2, limit: 5, resetAt: "2026-08-13T00:00:00.000Z" },
      { kind: "routine", used: 1, limit: 5, resetAt: "2026-08-13T00:00:00.000Z" },
      { kind: "chat", used: 7, limit: 20, resetAt: "2026-08-13T00:00:00.000Z" },
    ]);
  });

  it("vise le jour UTC et non le jour local : 23:30 UTC reste le 12", async () => {
    const { client, queries } = fakeClient({ data: null, error: null });

    await readAiQuotas(client, USER, LIMITS, new Date("2026-08-12T23:30:00.000Z"));

    expect(queries[0]?.filters.day).toBe("2026-08-12");
  });

  it("rend zéro consommé quand aucune ligne n'existe : c'est exact, pas un repli", async () => {
    const { client } = fakeClient({ data: null, error: null });
    const quotas = await readAiQuotas(client, USER, LIMITS, new Date("2026-08-12T10:00:00.000Z"));

    expect(quotas.map((quota) => quota.used)).toEqual([0, 0, 0]);
  });

  it("ne lève pas quand la lecture échoue : un affichage ne bloque pas une génération", async () => {
    const { client } = fakeClient({ data: null, error: { message: "réseau" } });
    const quotas = await readAiQuotas(client, USER, LIMITS, new Date("2026-08-12T10:00:00.000Z"));

    expect(quotas).toHaveLength(3);
    expect(quotas.map((quota) => quota.used)).toEqual([0, 0, 0]);
  });

  it("écarte une ligne hors contrat plutôt que d'afficher un compteur inventé", async () => {
    const { client } = fakeClient({
      data: { coach_count: "deux", routine_count: 1, chat_count: 1 },
      error: null,
    });
    const quotas = await readAiQuotas(client, USER, LIMITS, new Date("2026-08-12T10:00:00.000Z"));

    expect(quotas.map((quota) => quota.used)).toEqual([0, 0, 0]);
  });

  it("plafonne un compteur qui a dépassé sa limite (tentative refusée mais comptée)", async () => {
    const { client } = fakeClient({
      data: { coach_count: 9, routine_count: 0, chat_count: 0 },
      error: null,
    });
    const quotas = await readAiQuotas(client, USER, LIMITS, new Date("2026-08-12T10:00:00.000Z"));

    expect(quotas[0]).toEqual({
      kind: "coach",
      used: 5,
      limit: 5,
      resetAt: "2026-08-13T00:00:00.000Z",
    });
  });
});

describe("aiQuotaLimits", () => {
  it("prend coach et routine dans les réglages de plateforme, chat dans sa constante", () => {
    expect(
      aiQuotaLimits({ coachDaily: 3, routineDaily: 7, kovaaksImportDaily: 20, riotLinkDaily: 5 }),
    ).toEqual({ coach: 3, routine: 7, chat: 20 });
  });
});
