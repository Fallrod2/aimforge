/**
 * La bascule de SPEC §5 ter tient à un seul champ : `config.source`. C'est lui
 * que `api/coach` et `api/routine` lisent pour décider d'appeler — ou non — le
 * compteur de quota. Ce fichier vérifie donc que `source` vaut ce qu'il doit
 * valoir dans chaque cas, y compris les tordus (ligne hors contrat, base
 * muette) qu'on ne sait pas provoquer en production.
 *
 * Ce que ces tests ne peuvent pas atteindre : le `if (config.source ===
 * "platform")` des deux handlers, qui vit dans des fonctions serverless
 * (Supabase, réseau, environnement Vercel). Il se vérifie en parcours réel,
 * pas ici.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_ANTHROPIC_MODEL } from "../../shared/ai-settings-contract";
import {
  type LoadAiSettings,
  type PlatformAiConfig,
  resolveModelFor,
  type StoredAiSettings,
  toPublicSettings,
} from "./resolve";

const PLATFORM_KEY = "sk-ant-plateforme";

/**
 * La configuration de la plateforme telle que `api/_lib/platform-settings.ts`
 * la rend : depuis SPEC §5 quater, elle n'est plus forcément Anthropic — c'est
 * l'administration qui la choisit, et ce module ne fait que la relayer.
 */
const PLATFORM: PlatformAiConfig = {
  provider: "anthropic",
  model: DEFAULT_ANTHROPIC_MODEL,
  baseUrl: null,
  apiKey: PLATFORM_KEY,
};

const STORED: StoredAiSettings = {
  provider: "mistral",
  model: "mistral-large-latest",
  base_url: null,
  api_key: "cle-utilisateur",
  updated_at: "2026-08-09T10:00:00.000Z",
};

/** Une lecture de réglages qui rend toujours la même chose, et compte les appels. */
function loader(value: StoredAiSettings | null): LoadAiSettings & { calls: string[] } {
  const calls: string[] = [];
  const load = (async (userId: string) => {
    calls.push(userId);
    return value;
  }) as LoadAiSettings & { calls: string[] };

  load.calls = calls;
  return load;
}

describe("resolveModelFor — sans configuration personnelle", () => {
  it("rend la clé de la plateforme et son modèle", async () => {
    const resolution = await resolveModelFor(loader(null), "user-1", PLATFORM);

    expect(resolution).toEqual({
      ok: true,
      config: {
        source: "platform",
        provider: "anthropic",
        model: DEFAULT_ANTHROPIC_MODEL,
        baseUrl: null,
        apiKey: PLATFORM_KEY,
      },
    });
  });

  it("refuse quand la clé de la plateforme n'est pas posée", async () => {
    const resolution = await resolveModelFor(loader(null), "user-1", null);

    expect(resolution).toEqual({ ok: false, reason: "IA non configurée", status: 503 });
  });

  it("sert le fournisseur choisi par l'administration, pas seulement Anthropic", async () => {
    // SPEC §5 quater : la plateforme peut être configurée sur n'importe quel
    // fournisseur du contrat. `source` reste `platform` — donc le quota
    // s'applique toujours, quel que soit le fournisseur qui répond.
    const resolution = await resolveModelFor(loader(null), "user-1", {
      provider: "openai_compatible",
      model: "gpt-4.1",
      baseUrl: "https://api.exemple.com/v1",
      apiKey: "cle-plateforme",
    });

    expect(resolution).toEqual({
      ok: true,
      config: {
        source: "platform",
        provider: "openai_compatible",
        model: "gpt-4.1",
        baseUrl: "https://api.exemple.com/v1",
        apiKey: "cle-plateforme",
      },
    });
  });
});

describe("resolveModelFor — avec configuration personnelle", () => {
  it("rend le fournisseur de l'utilisateur, marqué `user`", async () => {
    const resolution = await resolveModelFor(loader(STORED), "user-1", PLATFORM);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.config).toEqual({
      source: "user",
      provider: "mistral",
      model: "mistral-large-latest",
      baseUrl: null,
      apiKey: "cle-utilisateur",
    });
  });

  it("ignore la clé de la plateforme, même absente", async () => {
    const resolution = await resolveModelFor(loader(STORED), "user-1", null);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.config.source).toBe("user");
    expect(resolution.config.apiKey).toBe("cle-utilisateur");
  });

  it("porte l'URL de base d'un serveur OpenAI-compatible", async () => {
    const load = loader({
      ...STORED,
      provider: "openai_compatible",
      model: "gpt-4.1",
      base_url: "https://api.exemple.com/v1",
    });
    const resolution = await resolveModelFor(load, "user-1", PLATFORM);

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.config.baseUrl).toBe("https://api.exemple.com/v1");
  });

  it("interroge la base pour l'utilisateur demandé, et lui seul", async () => {
    const load = loader(STORED);

    await resolveModelFor(load, "user-42", PLATFORM);
    expect(load.calls).toEqual(["user-42"]);
  });
});

describe("resolveModelFor — lignes hors contrat", () => {
  it("refuse un fournisseur inconnu plutôt que de retomber sur la plateforme", async () => {
    const resolution = await resolveModelFor(
      loader({ ...STORED, provider: "gemini" }),
      "user-1",
      PLATFORM,
    );

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.reason).toContain("Réglages IA");
    // 409 et non 503 : c'est la configuration de l'utilisateur qui est en
    // cause, et lui seul peut la corriger — même règle que `modelErrorStatus`.
    expect(resolution.status).toBe(409);
  });

  it("refuse un `openai_compatible` sans URL de base", async () => {
    const resolution = await resolveModelFor(
      loader({ ...STORED, provider: "openai_compatible", base_url: null }),
      "user-1",
      PLATFORM,
    );

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.status).toBe(409);
  });

  it("laisse remonter une base injoignable — sans basculer sur la plateforme", async () => {
    const load: LoadAiSettings = async () => {
      throw new Error("connexion perdue");
    };

    await expect(resolveModelFor(load, "user-1", PLATFORM)).rejects.toThrow("connexion perdue");
  });
});

describe("toPublicSettings", () => {
  it("rend la configuration sans jamais porter de clé", () => {
    const view = toPublicSettings({
      provider: "openai_compatible",
      model: "gpt-4.1",
      base_url: "https://api.exemple.com/v1",
      updated_at: "2026-08-09T10:00:00+00:00",
    });

    expect(view).toEqual({
      provider: "openai_compatible",
      model: "gpt-4.1",
      baseUrl: "https://api.exemple.com/v1",
      updatedAt: "2026-08-09T10:00:00.000Z",
      hasKey: true,
    });
    expect(JSON.stringify(view)).not.toContain("api_key");
  });

  it("refuse une ligne dont le fournisseur n'est plus au contrat", () => {
    expect(
      toPublicSettings({
        provider: "gemini",
        model: "x",
        base_url: null,
        updated_at: "2026-08-09T10:00:00.000Z",
      }),
    ).toBeNull();
  });

  it("refuse une date illisible plutôt que d'afficher « Invalid Date »", () => {
    expect(
      toPublicSettings({
        provider: "mistral",
        model: "x",
        base_url: null,
        updated_at: "jamais",
      }),
    ).toBeNull();
  });
});
