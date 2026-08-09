/**
 * Le contrat des réglages IA porte une promesse de sécurité, pas seulement une
 * forme : **la clé ne ressort jamais**. Un schéma de sortie qui laisserait
 * passer `api_key` ferait de la migration 0008 (write-only par privilèges de
 * colonne) un décor. C'est le premier test de ce fichier.
 */

import { describe, expect, it } from "vitest";
import {
  aiLinkPollResponseSchema,
  aiLinkStartResponseSchema,
  aiSettingsInputSchema,
  aiSettingsRequestSchema,
  aiSettingsSchema,
  DEFAULT_ANTHROPIC_MODEL,
  isLinkProvider,
  KEY_PROVIDERS,
  MAX_API_KEY_LENGTH,
  PROVIDER_IDS,
  PROVIDERS,
  providerSpec,
  storedAiSettingsSchema,
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

describe("aiSettingsInputSchema — la liaison de compte", () => {
  const LINKED = { provider: "chatgpt_subscription", model: "gpt-5" };

  it("accepte ChatGPT (abonnement) **sans** clé : il n'y en a pas à poser", () => {
    expect(aiSettingsInputSchema.safeParse(LINKED).success).toBe(true);
  });

  it("refuse une clé sur ce fournisseur : le navigateur n'a rien à envoyer", () => {
    // Le cas à ne pas rater : un client qui posterait une clé écraserait la
    // liaison enregistrée par un secret inutilisable.
    expect(
      aiSettingsInputSchema.safeParse({ ...LINKED, api_key: "sk-quelque-chose" }).success,
    ).toBe(false);
  });

  it("continue d'exiger la clé partout ailleurs", () => {
    expect(aiSettingsInputSchema.safeParse({ provider: "mistral", model: "m" }).success).toBe(
      false,
    );
  });
});

describe("storedAiSettingsSchema — la ligne relue par le serveur", () => {
  it("exige le secret, y compris pour une liaison (il porte les jetons)", () => {
    expect(
      storedAiSettingsSchema.safeParse({
        provider: "chatgpt_subscription",
        model: "gpt-5",
        base_url: null,
        api_key: JSON.stringify({ access_token: "a" }),
      }).success,
    ).toBe(true);
    expect(
      storedAiSettingsSchema.safeParse({ provider: "chatgpt_subscription", model: "gpt-5" })
        .success,
    ).toBe(false);
  });

  it("ne borne pas la longueur du secret : un groupe de jetons dépasse une clé", () => {
    expect(
      storedAiSettingsSchema.safeParse({
        provider: "chatgpt_subscription",
        model: "gpt-5",
        base_url: null,
        api_key: "j".repeat(MAX_API_KEY_LENGTH * 2),
      }).success,
    ).toBe(true);
  });
});

describe("aiSettingsRequestSchema", () => {
  it("n'accepte que les actions prévues", () => {
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

  it("accepte les deux gestes de la liaison, et exige le jeton opaque pour l'attente", () => {
    expect(aiSettingsRequestSchema.safeParse({ action: "link_start" }).success).toBe(true);
    expect(aiSettingsRequestSchema.safeParse({ action: "link_poll", handle: "a.b" }).success).toBe(
      true,
    );
    expect(aiSettingsRequestSchema.safeParse({ action: "link_poll" }).success).toBe(false);
    expect(aiSettingsRequestSchema.safeParse({ action: "link_poll", handle: "" }).success).toBe(
      false,
    );
  });
});

describe("les réponses de liaison ne portent jamais de jeton", () => {
  it("`link_start` ne rend que de quoi afficher la marche à suivre", () => {
    const parsed = aiLinkStartResponseSchema.parse({
      link: {
        userCode: "ABCD-1234",
        verificationUri: "https://auth.openai.com/codex/device",
        expiresIn: 900,
        handle: "corps.signature",
        access_token: "fuite",
        refresh_token: "fuite",
      },
    });

    expect(JSON.stringify(parsed)).not.toContain("fuite");
  });

  it("`link_poll` ne rend qu'un état et, au succès, la configuration publique", () => {
    const parsed = aiLinkPollResponseSchema.parse({
      status: "linked",
      settings: {
        provider: "chatgpt_subscription",
        model: "gpt-5",
        baseUrl: null,
        updatedAt: "2026-08-09T10:00:00.000Z",
        hasKey: true,
        api_key: "fuite",
      },
      tokens: { access_token: "fuite" },
    });

    expect(JSON.stringify(parsed)).not.toContain("fuite");
    expect(aiLinkPollResponseSchema.safeParse({ status: "attente", settings: null }).success).toBe(
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

  it("fait de ChatGPT (abonnement) le seul fournisseur à liaison de compte", () => {
    const linked = PROVIDERS.filter((spec) => spec.auth === "account_link").map((spec) => spec.id);

    expect(linked).toEqual(["chatgpt_subscription"]);
    expect(isLinkProvider("chatgpt_subscription")).toBe(true);
    expect(isLinkProvider("anthropic")).toBe(false);
  });

  it("n'annonce plus de champ de clé pour la liaison — il n'y en a plus", () => {
    const spec = providerSpec("chatgpt_subscription");

    expect(spec.auth).toBe("account_link");
    expect(spec).not.toHaveProperty("keyLabel");
    if (spec.auth !== "account_link") return;
    expect(spec.linkHint).toContain("Aucune clé");
  });

  it("KEY_PROVIDERS ne garde que ce que la plateforme peut servir", () => {
    expect(KEY_PROVIDERS.map((spec) => spec.id)).not.toContain("chatgpt_subscription");
    expect(KEY_PROVIDERS).toHaveLength(PROVIDERS.length - 1);
  });

  it("garde le modèle Anthropic de la plateforme comme défaut", () => {
    expect(providerSpec("anthropic").defaultModel).toBe(DEFAULT_ANTHROPIC_MODEL);
  });
});
