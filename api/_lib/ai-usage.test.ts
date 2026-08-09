/**
 * L'appel de remboursement, joué contre un faux `rpc`.
 *
 * Ce qui est vérifié ici n'est pas l'arithmétique du compteur (elle est en
 * base, migration 0010, et dans `createQuotaRefund` pour la part qui nous
 * revient) mais la **frontière** : le bon nom de fonction, les bons arguments,
 * le bon compteur, et surtout la promesse tenue en cas de panne — rendre `null`
 * plutôt que lever, parce que l'erreur qui a provoqué le remboursement est
 * celle que l'utilisateur doit lire.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { refundAiUsageWith } from "./ai-usage.js";

const USER = "utilisateur-1";

interface RpcCall {
  readonly name: string;
  readonly args: unknown;
}

function fakeService(result: { data: unknown; error: { message: string } | null }): {
  client: SupabaseClient;
  calls: RpcCall[];
} {
  const calls: RpcCall[] = [];
  const client = {
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args });
      return Promise.resolve(result);
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

describe("refundAiUsageWith", () => {
  it("appelle refund_ai_usage avec l'utilisateur et le compteur visés", async () => {
    const { client, calls } = fakeService({ data: 2, error: null });

    expect(await refundAiUsageWith(client, USER, "coach")()).toBe(2);
    expect(calls).toEqual([
      { name: "refund_ai_usage", args: { p_user_id: USER, p_kind: "coach" } },
    ]);
  });

  it("distingue les deux compteurs : une routine ne rembourse pas un debrief", async () => {
    const { client, calls } = fakeService({ data: 0, error: null });

    await refundAiUsageWith(client, USER, "routine")();
    expect(calls[0]?.args).toEqual({ p_user_id: USER, p_kind: "routine" });
  });

  it("rend null quand la base refuse, sans lever : l'erreur d'origine prime", async () => {
    const { client } = fakeService({ data: null, error: { message: "permission denied" } });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await refundAiUsageWith(client, USER, "coach")()).toBeNull();
    // La panne n'est pas silencieuse pour autant : elle part dans les logs de
    // la fonction, seul endroit où elle est utile.
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("rend null sur une valeur inattendue plutôt que de la propager", async () => {
    const { client } = fakeService({ data: "beaucoup", error: null });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await refundAiUsageWith(client, USER, "coach")()).toBeNull();
    logged.mockRestore();
  });

  it("accepte un compteur à zéro : c'est un compteur, pas une absence", async () => {
    const { client } = fakeService({ data: 0, error: null });

    expect(await refundAiUsageWith(client, USER, "coach")()).toBe(0);
  });
});
