/**
 * La rédaction des erreurs est du code métier, pas de la présentation : elle
 * décide de ce que l'utilisateur va **faire** ensuite. Confondre « ta clé est
 * refusée » et « le service est en panne », c'est envoyer quelqu'un attendre
 * alors que lui seul peut réparer.
 */

import { describe, expect, it } from "vitest";
import { CODEX_MODELS, DEFAULT_CODEX_MODEL } from "../../shared/ai-settings-contract";
import {
  ModelError,
  modelErrorMessage,
  modelErrorStatus,
  modelTestMessage,
  type ProviderConfig,
} from "./port";

const PLATFORM: Pick<ProviderConfig, "provider" | "source"> = {
  provider: "anthropic",
  source: "platform",
};

const USER: Pick<ProviderConfig, "provider" | "source"> = {
  provider: "openrouter",
  source: "user",
};

describe("modelErrorMessage — configuration de la plateforme", () => {
  it("ne parle jamais de réglages : l'utilisateur n'a rien à corriger", () => {
    const message = modelErrorMessage(new ModelError("auth", PLATFORM, "clé refusée"), "coach");

    expect(message).not.toContain("Réglages IA");
    expect(message).toContain("Le coach");
  });

  it("distingue la saturation du reste", () => {
    expect(modelErrorMessage(new ModelError("rate_limit", PLATFORM, "429"), "routine")).toContain(
      "saturé",
    );
  });
});

describe("modelErrorMessage — configuration personnelle", () => {
  it("désigne la configuration personnelle et l'endroit où la corriger", () => {
    const message = modelErrorMessage(new ModelError("auth", USER, "401"), "coach");

    expect(message).toContain("configuration IA personnelle");
    expect(message).toContain("Réglages IA");
  });

  it("dit que le quota reste levé — sinon on croit avoir tout perdu", () => {
    expect(modelErrorMessage(new ModelError("auth", USER, "401"), "coach")).toContain("quota");
  });

  it("oriente vers l'identifiant du modèle quand la requête est refusée", () => {
    expect(modelErrorMessage(new ModelError("request", USER, "400"), "routine")).toContain(
      "modèle",
    );
  });

  it("oriente vers l'URL de base quand le fournisseur est injoignable", () => {
    expect(
      modelErrorMessage(new ModelError("unreachable", USER, "econnrefused"), "coach"),
    ).toContain("URL de base");
  });
});

/**
 * Deux échecs que la production a fait passer pour ce qu'ils n'étaient pas.
 * Ces cas fixent la seule chose qui compte : ce que l'utilisateur lit, et donc
 * ce qu'il va faire.
 */
describe("modelErrorMessage — un modèle qui répond, mais pas à temps", () => {
  const EXPECTED =
    "Le modèle n'a pas répondu dans le temps imparti. Choisis un modèle plus rapide, ou réessaie.";

  it("ne dit jamais « injoignable » : le modèle a bien répondu", () => {
    for (const config of [USER, PLATFORM]) {
      const message = modelErrorMessage(new ModelError("timeout", config, "lecture"), "coach");

      expect(message).toBe(EXPECTED);
      expect(message).not.toContain("injoignable");
    }
  });

  it("dit la même chose à l'écran de test", () => {
    expect(modelTestMessage(new ModelError("timeout", USER, "lecture"))).toBe(EXPECTED);
  });
});

describe("modelErrorMessage — un budget parti en raisonnement", () => {
  const EXPECTED =
    "Ce modèle a dépensé son budget en raisonnement interne et n'a rien rendu. Choisis un modèle non-raisonneur, ou un budget plus grand.";

  it("nomme la cause au lieu de parler de réponse illisible", () => {
    for (const config of [USER, PLATFORM]) {
      const message = modelErrorMessage(
        new ModelError("reasoning_budget", config, "vide"),
        "routine",
      );

      expect(message).toBe(EXPECTED);
      expect(message).not.toContain("illisible");
    }
  });

  it("dit la même chose à l'écran de test", () => {
    expect(modelTestMessage(new ModelError("reasoning_budget", USER, "vide"))).toBe(EXPECTED);
  });
});

/**
 * Une liaison de compte n'a ni clé ni URL de base : les phrases génériques y
 * désignent des champs qui n'existent pas. Seul le modèle est réglable, et
 * c'est le seul geste que ces messages doivent demander.
 */
describe("modelErrorMessage — modèle refusé par l'abonnement ChatGPT", () => {
  const CODEX: Pick<ProviderConfig, "provider" | "source"> = {
    provider: "chatgpt_subscription",
    source: "user",
  };

  it("propose un modèle Codex et renvoie aux réglages", () => {
    const message = modelErrorMessage(new ModelError("request", CODEX, "modèle"), "coach");

    expect(message).toContain("abonnement ChatGPT");
    expect(message).toContain("modèle Codex");
    expect(message).toContain(DEFAULT_CODEX_MODEL);
    expect(message).toContain("Réglages IA");
  });

  it("ne renvoie pas aux réglages à l'écran de test — on y est déjà", () => {
    const message = modelTestMessage(new ModelError("request", CODEX, "modèle"));

    expect(message).toContain("modèle Codex");
    expect(message).not.toContain("Réglages IA");
  });

  it("propose un modèle que le back-end Codex sert réellement", () => {
    expect(CODEX_MODELS).toContain(DEFAULT_CODEX_MODEL);
  });
});

describe("modelErrorStatus", () => {
  it("impute un dépassement de délai au choix de modèle sur une config perso", () => {
    expect(modelErrorStatus(new ModelError("timeout", USER, "lent"))).toBe(409);
  });

  it("traite un dépassement de délai de la plateforme comme une indisponibilité", () => {
    expect(modelErrorStatus(new ModelError("timeout", PLATFORM, "lent"))).toBe(503);
  });

  it("traite un budget parti en raisonnement comme le dépassement de délai", () => {
    expect(modelErrorStatus(new ModelError("reasoning_budget", USER, "vide"))).toBe(409);
    expect(modelErrorStatus(new ModelError("reasoning_budget", PLATFORM, "vide"))).toBe(503);
  });

  it("rend 409 sur une configuration personnelle à corriger", () => {
    expect(modelErrorStatus(new ModelError("auth", USER, "401"))).toBe(409);
    expect(modelErrorStatus(new ModelError("request", USER, "400"))).toBe(409);
  });

  it("garde 502 pour une panne de la plateforme", () => {
    expect(modelErrorStatus(new ModelError("auth", PLATFORM, "401"))).toBe(502);
    expect(modelErrorStatus(new ModelError("unreachable", USER, "x"))).toBe(502);
  });

  it("rend 503 quand c'est une limite de débit", () => {
    expect(modelErrorStatus(new ModelError("rate_limit", USER, "429"))).toBe(503);
  });
});
