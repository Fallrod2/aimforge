/**
 * Le contrat des réglages IA porte une promesse de sécurité, pas seulement une
 * forme : **la clé ne ressort jamais**. Un schéma de sortie qui laisserait
 * passer `api_key` ferait de la migration 0008 (write-only par privilèges de
 * colonne) un décor. C'est le premier test de ce fichier.
 */

import { describe, expect, it } from "vitest";
import {
  aiSettingsInputSchema,
  aiSettingsRequestSchema,
  aiSettingsSchema,
  DEFAULT_ANTHROPIC_MODEL,
  PROVIDER_IDS,
  PROVIDERS,
  providerSpec,
} from "./ai-settings-contract";

const VALID = {
  provider: "anthropic",
  model: DEFAULT_ANTHROPIC_MODEL,
  api_key: "sk-ant-abc",
};

describe("aiSettingsSchema — la sortie", () => {
  it("ne laisse pas passer la clé, même quand la source en porte une", () => {
    const parsed = aiSettingsSchema.parse({
      provider: "mistral",
      model: "mistral-large-latest",
      baseUrl: null,
      updatedAt: "2026-08-09T10:00:00.000Z",
      hasKey: true,
      api_key: "sk-fuite",
      apiKey: "sk-fuite",
    });

    expect(parsed).not.toHaveProperty("api_key");
    expect(parsed).not.toHaveProperty("apiKey");
    expect(JSON.stringify(parsed)).not.toContain("sk-fuite");
  });

  it("exige `hasKey` : « configurée » n'est pas déductible de rien", () => {
    expect(
      aiSettingsSchema.safeParse({
        provider: "mistral",
        model: "m",
        baseUrl: null,
        updatedAt: "2026-08-09T10:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

describe("aiSettingsInputSchema — l'entrée", () => {
  it("accepte une configuration minimale", () => {
    expect(aiSettingsInputSchema.safeParse(VALID).success).toBe(true);
  });

  it("détoure la saisie : une clé faite d'espaces n'est pas une clé", () => {
    expect(aiSettingsInputSchema.safeParse({ ...VALID, api_key: "   " }).success).toBe(false);
    expect(aiSettingsInputSchema.safeParse({ ...VALID, model: "  " }).success).toBe(false);
  });

  it("refuse un fournisseur hors liste", () => {
    expect(aiSettingsInputSchema.safeParse({ ...VALID, provider: "gemini" }).success).toBe(false);
  });

  it("exige l'URL de base pour un serveur OpenAI-compatible", () => {
    const parsed = aiSettingsInputSchema.safeParse({
      ...VALID,
      provider: "openai_compatible",
      model: "gpt-4.1",
    });

    expect(parsed.success).toBe(false);
  });

  it("refuse une URL de base sur un fournisseur qui a son point d'entrée", () => {
    const parsed = aiSettingsInputSchema.safeParse({
      ...VALID,
      base_url: "https://api.exemple.com/v1",
    });

    expect(parsed.success).toBe(false);
  });

  it("accepte l'URL de base là où elle sert", () => {
    const parsed = aiSettingsInputSchema.safeParse({
      ...VALID,
      provider: "openai_compatible",
      model: "gpt-4.1",
      base_url: "https://api.exemple.com/v1",
    });

    expect(parsed.success).toBe(true);
  });
});

describe("aiSettingsRequestSchema", () => {
  it("n'accepte que les deux actions prévues", () => {
    expect(aiSettingsRequestSchema.safeParse({ action: "test", settings: VALID }).success).toBe(
      true,
    );
    expect(aiSettingsRequestSchema.safeParse({ action: "save", settings: VALID }).success).toBe(
      true,
    );
    expect(aiSettingsRequestSchema.safeParse({ action: "drop", settings: VALID }).success).toBe(
      false,
    );
  });
});

describe("PROVIDERS", () => {
  it("décrit exactement les fournisseurs du contrat — ni plus, ni moins", () => {
    expect(PROVIDERS.map((spec) => spec.id)).toEqual([...PROVIDER_IDS]);
  });

  it("propose un modèle par défaut qui figure dans ses suggestions", () => {
    for (const spec of PROVIDERS) {
      expect(spec.models).toContain(spec.defaultModel);
    }
  });

  it("n'exige une URL de base que pour le serveur OpenAI-compatible", () => {
    const withBaseUrl = PROVIDERS.filter((spec) => spec.needsBaseUrl).map((spec) => spec.id);

    expect(withBaseUrl).toEqual(["openai_compatible"]);
  });

  it("marque ChatGPT (abonnement) comme expérimental, avec l'avertissement", () => {
    const spec = providerSpec("chatgpt_subscription");

    expect(spec.experimental).toBeDefined();
    expect(spec.experimental).toContain("OpenAI");
    expect(spec.experimental).toContain("abonnement");
  });

  it("garde le modèle Anthropic de la plateforme comme défaut", () => {
    expect(providerSpec("anthropic").defaultModel).toBe(DEFAULT_ANTHROPIC_MODEL);
  });
});
