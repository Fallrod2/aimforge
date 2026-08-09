/**
 * Les écritures de `public.ai_settings`, jouées contre une table en mémoire.
 *
 * Ce fichier existe à cause d'un trou qu'aucun autre test ne pouvait voir : le
 * contrat vérifie la **forme** de ce qu'on envoie, la base vérifie ce qu'elle
 * accepte, et entre les deux vivait une écriture qui changeait le fournisseur
 * d'une ligne **sans changer son secret**. Une clé Anthropic se retrouvait
 * étiquetée « ChatGPT (abonnement) », l'écran affichait « Compte lié » sans
 * qu'aucune autorisation ait eu lieu, et l'imposture ne se découvrait qu'au
 * premier debrief.
 *
 * La règle que ces cas tiennent, et qui est la vraie correction : **le
 * fournisseur à liaison ne s'écrit que par la liaison**. `saveSettings` ne peut
 * plus y amener une ligne ; il peut seulement changer le modèle d'une liaison
 * qui existe déjà.
 *
 * Le faux client imite ce que PostgREST fait vraiment — `update` qui ne touche
 * aucune ligne rend `null` sans erreur, `insert` en double rend 23505 — parce
 * que c'est sur ces deux comportements que le code décide.
 */

import { describe, expect, it } from "vitest";
import type { AiSettingsInput } from "../../src/shared/ai-settings-contract.js";
import {
  deleteSettings,
  linkChatGptSettings,
  persistChatGptTokensWith,
  readSettings,
  saveSettings,
  type UserClient,
} from "./ai-settings.js";

/* ------------------------------------------------------------------ */
/* Une table `ai_settings` en mémoire                                  */
/* ------------------------------------------------------------------ */

interface Row {
  user_id: string;
  provider: string;
  model: string;
  base_url: string | null;
  api_key: string;
  updated_at: string;
}

const USER = "utilisateur-1";
const BUNDLE = JSON.stringify({ access_token: "acces", refresh_token: "rafraichir" });

function anthropicRow(): Row {
  return {
    user_id: USER,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    base_url: null,
    api_key: "sk-ant-la-cle-de-l-utilisateur",
    updated_at: "2026-08-09T10:00:00.000Z",
  };
}

function linkedRow(): Row {
  return {
    user_id: USER,
    provider: "chatgpt_subscription",
    model: "gpt-5",
    base_url: null,
    api_key: BUNDLE,
    updated_at: "2026-08-09T10:00:00.000Z",
  };
}

interface Result {
  data: Record<string, unknown> | null;
  error: { code?: string; message: string } | null;
}

/** Ce que le client a le droit de relire : jamais `api_key` (migration 0008). */
function publicView(row: Row): Record<string, unknown> {
  return {
    provider: row.provider,
    model: row.model,
    base_url: row.base_url,
    updated_at: row.updated_at,
  };
}

class Store {
  row: Row | null;
  /** Les corps d'écriture reçus, dans l'ordre : c'est ce qu'on inspecte. */
  readonly updates: Record<string, unknown>[] = [];
  readonly inserts: Record<string, unknown>[] = [];

  constructor(row: Row | null) {
    this.row = row;
  }
}

type Operation = "select" | "update" | "insert" | "delete";

class Query implements PromiseLike<Result> {
  private readonly filters: Record<string, unknown> = {};

  constructor(
    private readonly store: Store,
    private readonly operation: Operation,
    private readonly payload: Record<string, unknown> = {},
  ) {}

  eq(column: string, value: unknown): this {
    this.filters[column] = value;
    return this;
  }

  select(columns: string): this {
    // Le code doit toujours nommer ses colonnes : un `select()` nu relirait
    // `api_key`, que les privilèges de colonne refusent.
    if (columns.includes("api_key") && this.operation !== "select") {
      throw new Error("relecture de api_key après écriture : refusée par la base");
    }
    return this;
  }

  maybeSingle(): Promise<Result> {
    return Promise.resolve(this.execute());
  }

  /**
   * Le constructeur de requête de PostgREST **est** une promesse, et deux
   * chemins du module comptent dessus : la suppression et la réécriture des
   * jetons attendent la chaîne sans passer par `maybeSingle()`. Un faux qui ne
   * serait pas « thenable » ne testerait donc pas le code tel qu'il s'exécute —
   * il rendrait le constructeur lui-même, et `error` serait `undefined`.
   */
  // biome-ignore lint/suspicious/noThenProperty: imite le constructeur de requête de PostgREST, qui est une promesse (voir ci-dessus).
  then<A, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  single(): Promise<Result> {
    const result = this.execute();

    if (result.data === null && result.error === null) {
      return Promise.resolve({ data: null, error: { code: "PGRST116", message: "no rows" } });
    }
    return Promise.resolve(result);
  }

  private matches(): boolean {
    const row = this.store.row;

    if (row === null) return false;
    return Object.entries(this.filters).every(
      ([column, value]) => (row as unknown as Record<string, unknown>)[column] === value,
    );
  }

  /** L'exécution effective, appelée par le dernier maillon de la chaîne. */
  private execute(): Result {
    const store = this.store;

    switch (this.operation) {
      case "select":
        return {
          data: this.matches() && store.row !== null ? publicView(store.row) : null,
          error: null,
        };

      case "update": {
        store.updates.push(this.payload);
        // PostgREST : une modification qui ne touche aucune ligne n'est pas une
        // erreur — elle rend simplement zéro ligne.
        if (!this.matches() || store.row === null) return { data: null, error: null };
        store.row = { ...store.row, ...(this.payload as Partial<Row>) };
        return { data: publicView(store.row), error: null };
      }

      case "insert": {
        store.inserts.push(this.payload);
        if (store.row !== null) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        store.row = { updated_at: "2026-08-09T11:00:00.000Z", ...this.payload } as Row;
        return { data: publicView(store.row), error: null };
      }

      case "delete":
        if (this.matches()) store.row = null;
        return { data: null, error: null };
    }
  }
}

function fakeClient(row: Row | null): { client: UserClient; store: Store } {
  const store = new Store(row);
  const client = {
    from: (table: string) => {
      if (table !== "ai_settings") throw new Error(`table inattendue: ${table}`);
      return {
        select: (columns: string) => new Query(store, "select").select(columns),
        update: (payload: Record<string, unknown>) => new Query(store, "update", payload),
        insert: (payload: Record<string, unknown>) => new Query(store, "insert", payload),
        delete: () => new Query(store, "delete"),
      };
    },
  };

  return { client: client as unknown as UserClient, store };
}

const CHATGPT_INPUT: AiSettingsInput = {
  provider: "chatgpt_subscription",
  model: "gpt-5-codex",
  base_url: null,
};

const ANTHROPIC_INPUT: AiSettingsInput = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  base_url: null,
  api_key: "sk-ant-nouvelle",
};

/* ------------------------------------------------------------------ */
/* Le trou : basculer vers la liaison par le simple enregistrement     */
/* ------------------------------------------------------------------ */

describe("saveSettings — le fournisseur à liaison ne s'écrit pas à la main", () => {
  it("refuse de faire passer une ligne à clé vers ChatGPT (abonnement)", async () => {
    // Le geste attaquant tient en un POST : choisir le fournisseur à liaison
    // sans jamais lier. Avant le correctif, la ligne changeait de fournisseur
    // en gardant la clé Anthropic — « Compte lié » sans autorisation, et un
    // secret servi à un back-end à qui il n'appartient pas.
    const { client, store } = fakeClient(anthropicRow());
    const saved = await saveSettings(client, USER, CHATGPT_INPUT);

    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    // `null` = rien d'écrit : l'appelant en fait un 409 « lie d'abord ton compte ».
    expect(saved.value).toBeNull();
    expect(store.row?.provider).toBe("anthropic");
    expect(store.row?.model).toBe("claude-sonnet-4-6");
    expect(store.row?.api_key).toBe("sk-ant-la-cle-de-l-utilisateur");
  });

  it("n'écrit jamais `provider` sur ce chemin, même quand rien ne change", async () => {
    // La preuve par les colonnes touchées : aucune écriture ne doit pouvoir
    // déplacer une ligne d'un fournisseur à l'autre sans son secret.
    const { client, store } = fakeClient(anthropicRow());

    await saveSettings(client, USER, CHATGPT_INPUT);
    for (const update of store.updates) {
      expect(update).not.toHaveProperty("provider");
    }
    expect(store.inserts).toHaveLength(0);
  });

  it("refuse aussi quand il n'y a aucune ligne : la liaison crée la sienne", async () => {
    const { client, store } = fakeClient(null);
    const saved = await saveSettings(client, USER, CHATGPT_INPUT);

    expect(saved).toEqual({ ok: true, value: null });
    expect(store.row).toBeNull();
    expect(store.inserts).toHaveLength(0);
  });
});

describe("saveSettings — le cas légitime : changer de modèle après liaison", () => {
  it("change le modèle d'une liaison existante sans toucher aux jetons", async () => {
    const { client, store } = fakeClient(linkedRow());
    const saved = await saveSettings(client, USER, CHATGPT_INPUT);

    expect(saved.ok).toBe(true);
    if (!saved.ok || saved.value === null) throw new Error("le modèle aurait dû être enregistré");
    expect(saved.value.model).toBe("gpt-5-codex");
    expect(store.row?.provider).toBe("chatgpt_subscription");
    // Les jetons de la liaison sont intacts : l'écran ne les a jamais eus.
    expect(store.row?.api_key).toBe(BUNDLE);
    for (const update of store.updates) {
      expect(update).not.toHaveProperty("api_key");
    }
  });
});

describe("saveSettings — les fournisseurs à clé n'ont pas changé", () => {
  it("crée la ligne quand il n'y en a pas", async () => {
    const { client, store } = fakeClient(null);
    const saved = await saveSettings(client, USER, ANTHROPIC_INPUT);

    expect(saved.ok).toBe(true);
    if (!saved.ok || saved.value === null) throw new Error("la ligne aurait dû être créée");
    expect(saved.value.provider).toBe("anthropic");
    expect(store.row?.api_key).toBe("sk-ant-nouvelle");
  });

  it("remplace la configuration existante, clé comprise", async () => {
    const { client, store } = fakeClient(linkedRow());
    const saved = await saveSettings(client, USER, ANTHROPIC_INPUT);

    expect(saved.ok).toBe(true);
    // Quitter une liaison pour une clé est un geste explicite et complet : la
    // clé est fournie, donc la ligne entière est réécrite.
    expect(store.row?.provider).toBe("anthropic");
    expect(store.row?.api_key).toBe("sk-ant-nouvelle");
  });

  it("exige une URL de base cohérente jusque dans la ligne écrite", async () => {
    const { client, store } = fakeClient(null);

    await saveSettings(client, USER, {
      provider: "openai_compatible",
      model: "gpt-4.1",
      base_url: "https://api.exemple.com/v1",
      api_key: "sk-serveur",
    });

    expect(store.row?.base_url).toBe("https://api.exemple.com/v1");
  });
});

/* ------------------------------------------------------------------ */
/* La liaison, elle, écrit bien le fournisseur                         */
/* ------------------------------------------------------------------ */

describe("linkChatGptSettings", () => {
  it("crée la ligne quand il n'y en a pas, avec le modèle par défaut", async () => {
    const { client, store } = fakeClient(null);
    const saved = await linkChatGptSettings(client, USER, BUNDLE);

    expect(saved.ok).toBe(true);
    if (!saved.ok || saved.value === null) throw new Error("la liaison aurait dû être écrite");
    expect(saved.value.provider).toBe("chatgpt_subscription");
    expect(store.row?.api_key).toBe(BUNDLE);
  });

  it("remplace une configuration à clé : c'est le geste annoncé par l'écran", async () => {
    const { client, store } = fakeClient(anthropicRow());

    await linkChatGptSettings(client, USER, BUNDLE);
    expect(store.row?.provider).toBe("chatgpt_subscription");
    // La clé d'avant ne survit pas à la liaison : elle serait servie à OpenAI.
    expect(store.row?.api_key).toBe(BUNDLE);
  });

  it("garde le modèle déjà choisi quand on relie le même fournisseur", async () => {
    const { client, store } = fakeClient({ ...linkedRow(), model: "gpt-5-codex" });

    await linkChatGptSettings(client, USER, "nouveau-groupe");
    expect(store.row?.model).toBe("gpt-5-codex");
    expect(store.row?.api_key).toBe("nouveau-groupe");
  });
});

/* ------------------------------------------------------------------ */
/* Réécriture des jetons rafraîchis                                    */
/* ------------------------------------------------------------------ */

describe("persistChatGptTokensWith", () => {
  it("réécrit les jetons, et rien d'autre", async () => {
    const { client, store } = fakeClient(linkedRow());

    await persistChatGptTokensWith(client, USER)("groupe-rafraichi");
    expect(store.row?.api_key).toBe("groupe-rafraichi");
    expect(store.updates).toEqual([{ api_key: "groupe-rafraichi" }]);
  });

  it("ne touche rien si la configuration a changé de fournisseur entre-temps", async () => {
    const { client, store } = fakeClient(anthropicRow());

    await persistChatGptTokensWith(client, USER)("groupe-rafraichi");
    expect(store.row?.api_key).toBe("sk-ant-la-cle-de-l-utilisateur");
  });
});

/* ------------------------------------------------------------------ */
/* Lecture et suppression                                              */
/* ------------------------------------------------------------------ */

describe("readSettings / deleteSettings", () => {
  it("ne rend jamais la clé", async () => {
    const { client } = fakeClient(anthropicRow());
    const read = await readSettings(client, USER);

    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(JSON.stringify(read.value)).not.toContain("sk-ant");
  });

  it("supprimer est idempotent : l'état demandé compte, pas le nombre de lignes", async () => {
    const { client, store } = fakeClient(linkedRow());

    expect(await deleteSettings(client, USER)).toEqual({ ok: true, value: null });
    expect(store.row).toBeNull();
    expect(await deleteSettings(client, USER)).toEqual({ ok: true, value: null });
  });
});
