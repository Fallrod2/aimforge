/**
 * La rédaction des erreurs est du code métier, pas de la présentation : elle
 * décide de ce que l'utilisateur va **faire** ensuite. Confondre « ta clé est
 * refusée » et « le service est en panne », c'est envoyer quelqu'un attendre
 * alors que lui seul peut réparer.
 */

import { describe, expect, it } from "vitest";
import { ModelError, modelErrorMessage, modelErrorStatus, type ProviderConfig } from "./port";

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

describe("modelErrorStatus", () => {
  it("rend 504 sur un dépassement de délai", () => {
    expect(modelErrorStatus(new ModelError("timeout", PLATFORM, "lent"))).toBe(504);
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
