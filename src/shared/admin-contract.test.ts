/**
 * Le contrat d'administration est la frontière où un panneau de configuration
 * devient une écriture en base. Ces tests vérifient les deux choses qu'un
 * schéma trop permissif laisserait passer sans bruit :
 *
 * - **la distinction absent / `null` / valeur**, qui porte tout
 *   l'enregistrement partiel. La confondre, c'est effacer une clé en
 *   enregistrant un quota ;
 * - **la cohérence du bloc IA**, la même qu'en migration 0009 et qu'au contrat
 *   des réglages personnels : une URL de base n'existe que pour un serveur
 *   OpenAI-compatible, et un fournisseur sans elle n'est pas appelable.
 */

import { describe, expect, it } from "vitest";
import {
  adminSettingsSaveSchema,
  adminSettingsSchema,
  GLOBAL_LIMIT_MAX,
  QUOTA_MAX,
  USAGE_WINDOW_DAYS,
} from "./admin-contract";

const AI = { provider: "anthropic", model: "claude-sonnet-4-6", api_key: "sk-ant-x" };

describe("adminSettingsSaveSchema — enregistrement partiel", () => {
  it("accepte un bloc seul et ne fabrique rien pour les autres", () => {
    const parsed = adminSettingsSaveSchema.parse({ limits: quotas(3) });

    expect(parsed.limits).toEqual(quotas(3));
    // Les champs absents doivent **rester** absents : c'est ce que
    // `api/admin/settings` lit pour ne pas y toucher.
    expect(Object.hasOwn(parsed, "ai")).toBe(false);
    expect(Object.hasOwn(parsed, "henrikdevApiKey")).toBe(false);
    expect(Object.hasOwn(parsed, "aiGlobalDailyLimit")).toBe(false);
  });

  it("distingue `null` (efface, donc retombe sur l'environnement) de l'absence", () => {
    const cleared = adminSettingsSaveSchema.parse({ ai: null, henrikdevApiKey: null });

    expect(cleared.ai).toBeNull();
    expect(cleared.henrikdevApiKey).toBeNull();
  });

  it("refuse un corps vide : il ne veut rien dire", () => {
    expect(adminSettingsSaveSchema.safeParse({}).success).toBe(false);
  });

  it("accepte un plafond global nul (plateforme fermée) et son effacement", () => {
    expect(adminSettingsSaveSchema.parse({ aiGlobalDailyLimit: 0 }).aiGlobalDailyLimit).toBe(0);
    expect(
      adminSettingsSaveSchema.parse({ aiGlobalDailyLimit: null }).aiGlobalDailyLimit,
    ).toBeNull();
  });

  it("refuse les quotas hors bornes, y compris négatifs et non entiers", () => {
    expect(adminSettingsSaveSchema.safeParse({ limits: quotas(-1) }).success).toBe(false);
    expect(adminSettingsSaveSchema.safeParse({ limits: quotas(1.5) }).success).toBe(false);
    expect(adminSettingsSaveSchema.safeParse({ limits: quotas(QUOTA_MAX + 1) }).success).toBe(
      false,
    );
    expect(adminSettingsSaveSchema.safeParse({ limits: quotas(QUOTA_MAX) }).success).toBe(true);
    expect(
      adminSettingsSaveSchema.safeParse({ aiGlobalDailyLimit: GLOBAL_LIMIT_MAX + 1 }).success,
    ).toBe(false);
  });

  it("refuse un bloc de quotas incomplet : les quatre voyagent ensemble", () => {
    expect(adminSettingsSaveSchema.safeParse({ limits: { coachDaily: 5 } }).success).toBe(false);
  });
});

describe("adminSettingsSaveSchema — cohérence du bloc IA", () => {
  it("accepte une configuration complète", () => {
    expect(adminSettingsSaveSchema.safeParse({ ai: AI }).success).toBe(true);
  });

  it("accepte une configuration sans clé : elle garde celle déjà enregistrée", () => {
    const parsed = adminSettingsSaveSchema.parse({
      ai: { provider: "anthropic", model: "claude-haiku-4-5" },
    });

    expect(parsed.ai?.api_key).toBeUndefined();
  });

  it("exige une URL de base pour un serveur OpenAI-compatible", () => {
    expect(
      adminSettingsSaveSchema.safeParse({
        ai: { provider: "openai_compatible", model: "gpt-4.1", api_key: "k" },
      }).success,
    ).toBe(false);
    expect(
      adminSettingsSaveSchema.safeParse({
        ai: {
          provider: "openai_compatible",
          model: "gpt-4.1",
          api_key: "k",
          base_url: "https://api.exemple.com/v1",
        },
      }).success,
    ).toBe(true);
  });

  it("refuse une URL de base sur un fournisseur qui a son propre point d'entrée", () => {
    // La laisser passer ferait croire qu'elle est lue — la contrainte de la
    // migration 0009 refuserait l'écriture, mais bien plus loin.
    expect(
      adminSettingsSaveSchema.safeParse({ ai: { ...AI, base_url: "https://ailleurs.test/v1" } })
        .success,
    ).toBe(false);
  });

  it("refuse un fournisseur hors contrat et une clé vide", () => {
    expect(adminSettingsSaveSchema.safeParse({ ai: { ...AI, provider: "gemini" } }).success).toBe(
      false,
    );
    expect(adminSettingsSaveSchema.safeParse({ ai: { ...AI, api_key: "   " } }).success).toBe(
      false,
    );
    expect(adminSettingsSaveSchema.safeParse({ henrikdevApiKey: "  " }).success).toBe(false);
  });
});

describe("adminSettingsSchema — ce qui sort", () => {
  it("n'a aucun champ de clé : l'omission est le contrat", () => {
    const keys = Object.keys(adminSettingsSchema.shape);

    expect(keys).not.toContain("aiApiKey");
    expect(keys).not.toContain("henrikdevApiKey");
    expect(keys).toContain("hasAiKey");
    expect(keys).toContain("hasHenrikKey");
  });

  it("accepte une date absente quand la ligne n'a pas pu être lue", () => {
    const settings = {
      ai: null,
      hasAiKey: false,
      aiKeySource: "environment",
      hasHenrikKey: false,
      henrikKeySource: "none",
      limits: quotas(5),
      aiGlobalDailyLimit: null,
      updatedAt: null,
    };

    expect(adminSettingsSchema.safeParse(settings).success).toBe(true);
  });
});

describe("fenêtre d'usage", () => {
  it("couvre quatorze jours, comme la spec l'annonce", () => {
    expect(USAGE_WINDOW_DAYS).toBe(14);
  });
});

function quotas(value: number) {
  return {
    coachDaily: value,
    routineDaily: value,
    kovaaksImportDaily: value,
    riotLinkDaily: value,
  };
}
