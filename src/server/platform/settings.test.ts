/**
 * Le repli est la seule chose que ce module doit garantir, et c'est
 * précisément ce qu'on ne peut pas vérifier en production : on n'y videra pas
 * `platform_settings` pour voir.
 *
 * Ces tests ferment donc la question posée par la mise en service du panneau
 * d'administration : **est-ce que poser cette table change quelque chose pour
 * quelqu'un qui n'y touche pas ?** La réponse doit être non, colonne par
 * colonne — sinon la migration 0009 est une régression déguisée.
 */

import { describe, expect, it } from "vitest";
import { KOVAAKS_IMPORT_DAILY_LIMIT } from "../../client/data/linked-accounts-contract";
import { DEFAULT_ANTHROPIC_MODEL } from "../../shared/ai-settings-contract";
import { COACH_DAILY_QUOTA } from "../../shared/coach-contract";
import {
  DEFAULT_LIMITS,
  globalCapReached,
  type PlatformEnv,
  type PlatformSettingsRow,
  resolvePlatformSettings,
  toAdminSettings,
} from "./settings";

const ENV: PlatformEnv = { anthropicKey: "sk-ant-env", henrikdevKey: "henrik-env" };

const NO_ENV: PlatformEnv = { anthropicKey: "", henrikdevKey: "" };

/** Une ligne « tout vide », telle que la migration 0009 l'amorce. */
const SEEDED: PlatformSettingsRow = {
  ai_provider: null,
  ai_model: null,
  ai_base_url: null,
  ai_api_key: null,
  henrikdev_api_key: null,
  coach_daily: 5,
  routine_daily: 5,
  kovaaks_import_daily: 20,
  riot_link_daily: 10,
  ai_global_daily_limit: null,
  updated_at: "2026-08-09T10:00:00.000Z",
};

describe("resolvePlatformSettings — rien en base", () => {
  it.each([
    ["ligne absente", null],
    ["ligne amorcée, toutes colonnes de configuration nulles", SEEDED],
  ])("retombe sur l'environnement et les constantes d'avant (%s)", (_label, row) => {
    const resolved = resolvePlatformSettings(row, ENV);

    expect(resolved.ai).toEqual({
      provider: "anthropic",
      model: DEFAULT_ANTHROPIC_MODEL,
      baseUrl: null,
      apiKey: "sk-ant-env",
    });
    expect(resolved.aiKeySource).toBe("environment");
    expect(resolved.henrikdevKey).toBe("henrik-env");
    expect(resolved.henrikKeySource).toBe("environment");
    expect(resolved.limits).toEqual(DEFAULT_LIMITS);
    expect(resolved.aiGlobalDailyLimit).toBeNull();
  });

  it("garde les défauts identiques aux constantes d'avant le panneau", () => {
    // Le test qui rend la migration 0009 sans effet de bord : si quelqu'un
    // change un défaut ici sans le vouloir, le quota d'un utilisateur change.
    expect(DEFAULT_LIMITS.coachDaily).toBe(COACH_DAILY_QUOTA);
    expect(DEFAULT_LIMITS.kovaaksImportDaily).toBe(KOVAAKS_IMPORT_DAILY_LIMIT);
  });

  it("rend `ai: null` quand il n'y a de clé nulle part — pas une config inutilisable", () => {
    const resolved = resolvePlatformSettings(null, NO_ENV);

    expect(resolved.ai).toBeNull();
    expect(resolved.aiKeySource).toBe("none");
    expect(resolved.henrikdevKey).toBe("");
    expect(resolved.henrikKeySource).toBe("none");
  });
});

describe("resolvePlatformSettings — repli champ par champ", () => {
  it("prend la clé HenrikDev en base sans toucher à la config IA", () => {
    const resolved = resolvePlatformSettings({ ...SEEDED, henrikdev_api_key: "henrik-base" }, ENV);

    expect(resolved.henrikdevKey).toBe("henrik-base");
    expect(resolved.henrikKeySource).toBe("database");
    // L'IA n'a pas bougé : un réglage configuré n'en tire aucun autre.
    expect(resolved.aiKeySource).toBe("environment");
    expect(resolved.ai?.apiKey).toBe("sk-ant-env");
  });

  it("prend la config IA en base sans toucher à la clé HenrikDev", () => {
    const resolved = resolvePlatformSettings(
      {
        ...SEEDED,
        ai_provider: "mistral",
        ai_model: "mistral-large-latest",
        ai_api_key: "cle-plateforme",
      },
      ENV,
    );

    expect(resolved.ai).toEqual({
      provider: "mistral",
      model: "mistral-large-latest",
      baseUrl: null,
      apiKey: "cle-plateforme",
    });
    expect(resolved.aiKeySource).toBe("database");
    expect(resolved.henrikKeySource).toBe("environment");
  });

  it("prend un quota en base et laisse les trois autres à leur défaut", () => {
    const resolved = resolvePlatformSettings({ ...SEEDED, coach_daily: 2 }, ENV);

    expect(resolved.limits).toEqual({ ...DEFAULT_LIMITS, coachDaily: 2 });
  });

  it("accepte un quota à zéro : fermer une fonctionnalité est un réglage, pas une erreur", () => {
    const resolved = resolvePlatformSettings({ ...SEEDED, routine_daily: 0 }, ENV);

    expect(resolved.limits.routineDaily).toBe(0);
  });

  it("porte l'URL de base d'un serveur OpenAI-compatible", () => {
    const resolved = resolvePlatformSettings(
      {
        ...SEEDED,
        ai_provider: "openai_compatible",
        ai_model: "gpt-4.1",
        ai_base_url: "https://api.exemple.com/v1",
        ai_api_key: "cle",
      },
      ENV,
    );

    expect(resolved.ai?.baseUrl).toBe("https://api.exemple.com/v1");
  });

  it("lit le plafond global, y compris zéro (plateforme fermée)", () => {
    expect(
      resolvePlatformSettings({ ...SEEDED, ai_global_daily_limit: 0 }, ENV).aiGlobalDailyLimit,
    ).toBe(0);
    expect(
      resolvePlatformSettings({ ...SEEDED, ai_global_daily_limit: 250 }, ENV).aiGlobalDailyLimit,
    ).toBe(250);
  });
});

describe("resolvePlatformSettings — lignes hors contrat", () => {
  it("ignore une clé posée sans fournisseur lisible plutôt que de deviner à qui la donner", () => {
    // Servir une clé à un fournisseur inconnu ne produirait pas un repli, mais
    // un échec à chaque appel — et un échec dont personne ne saurait la cause.
    const resolved = resolvePlatformSettings(
      { ...SEEDED, ai_provider: "gemini", ai_model: "x", ai_api_key: "cle" },
      ENV,
    );

    expect(resolved.storedAi).toBeNull();
    expect(resolved.ai?.provider).toBe("anthropic");
    expect(resolved.ai?.apiKey).toBe("sk-ant-env");
    expect(resolved.aiKeySource).toBe("environment");
  });

  it("ignore un fournisseur à liaison de compte : la plateforme n'a personne à lier", () => {
    // ChatGPT (abonnement) s'autorise depuis le compte d'une personne (SPEC
    // §5 ter) : la colonne `ai_api_key` de la plateforme ne peut pas porter une
    // liaison. La ligne est ignorée, et le repli d'environnement reprend — le
    // comportement d'avant, donc celui qu'on sait juste.
    const resolved = resolvePlatformSettings(
      { ...SEEDED, ai_provider: "chatgpt_subscription", ai_model: "gpt-5", ai_api_key: "jetons" },
      ENV,
    );

    expect(resolved.storedAi).toBeNull();
    expect(resolved.ai?.provider).toBe("anthropic");
    expect(resolved.aiKeySource).toBe("environment");
  });

  it("ignore un `openai_compatible` privé de son URL de base", () => {
    const resolved = resolvePlatformSettings(
      { ...SEEDED, ai_provider: "openai_compatible", ai_model: "gpt-4.1", ai_api_key: "cle" },
      ENV,
    );

    expect(resolved.storedAi).toBeNull();
    expect(resolved.aiKeySource).toBe("environment");
  });

  it("traite une clé faite d'espaces comme une clé absente", () => {
    const resolved = resolvePlatformSettings(
      { ...SEEDED, henrikdev_api_key: "   ", ai_api_key: "  " },
      ENV,
    );

    expect(resolved.henrikdevKey).toBe("henrik-env");
    expect(resolved.hasStoredHenrikKey).toBe(false);
    expect(resolved.hasStoredAiKey).toBe(false);
  });

  it("retombe sur les défauts pour un quota négatif ou non entier", () => {
    const resolved = resolvePlatformSettings(
      { ...SEEDED, coach_daily: -3, riot_link_daily: 2.5 },
      ENV,
    );

    expect(resolved.limits.coachDaily).toBe(DEFAULT_LIMITS.coachDaily);
    expect(resolved.limits.riotLinkDaily).toBe(DEFAULT_LIMITS.riotLinkDaily);
  });
});

describe("toAdminSettings", () => {
  it("ne porte jamais de clé, seulement leur présence et leur provenance", () => {
    const view = toAdminSettings(
      resolvePlatformSettings(
        {
          ...SEEDED,
          ai_provider: "anthropic",
          ai_model: "claude-sonnet-4-6",
          ai_api_key: "sk-ant-secret-de-la-plateforme",
          henrikdev_api_key: "henrik-secret",
        },
        ENV,
      ),
    );

    expect(view.ai).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6", baseUrl: null });
    expect(view.hasAiKey).toBe(true);
    expect(view.aiKeySource).toBe("database");
    expect(view.hasHenrikKey).toBe(true);

    const serialized = JSON.stringify(view);

    expect(serialized).not.toContain("sk-ant-secret-de-la-plateforme");
    expect(serialized).not.toContain("henrik-secret");
    expect(serialized).not.toContain("api_key");
  });

  it("rend `updatedAt: null` quand la ligne n'a pas pu être lue", () => {
    expect(toAdminSettings(resolvePlatformSettings(null, ENV)).updatedAt).toBeNull();
  });
});

describe("globalCapReached", () => {
  it("laisse passer quand il n'y a pas de plafond", () => {
    expect(globalCapReached(10_000, null)).toBe(false);
  });

  it("laisse passer tant que le plafond n'est pas atteint", () => {
    expect(globalCapReached(0, 10)).toBe(false);
    expect(globalCapReached(9, 10)).toBe(false);
  });

  it("refuse à partir du plafond, pas après", () => {
    // `>=` et non `>` : le dixième appel a déjà été fait, le onzième dépasserait.
    expect(globalCapReached(10, 10)).toBe(true);
    expect(globalCapReached(11, 10)).toBe(true);
  });

  it("ferme complètement la plateforme sur un plafond à zéro", () => {
    expect(globalCapReached(0, 0)).toBe(true);
  });
});
