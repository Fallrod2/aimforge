/**
 * Le SDK est remplacé par un faux : ce qui se vérifie ici n'est pas le réseau,
 * c'est **ce que l'adaptateur retient de la réponse**.
 *
 * Le cas qui compte est la sortie coupée au plafond de jetons : elle arrive
 * avec un texte parfaitement lisible, et rien dans ce texte ne dit qu'il
 * manque la fin. Sans `stop_reason`, personne en aval ne peut le savoir.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelRequest, ProviderConfig } from "./port";

const state = vi.hoisted(() => ({
  /** La réponse que le faux SDK rendra au prochain appel. */
  reply: { content: [{ type: "text", text: "" }], stop_reason: "end_turn" } as unknown,
}));

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    readonly status: number | null = null;
  }
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class RateLimitError extends APIError {}
  class NotFoundError extends APIError {}
  class BadRequestError extends APIError {}
  class APIConnectionTimeoutError extends APIError {}

  const Anthropic = class {
    readonly messages = { create: () => Promise.resolve(state.reply) };
  };

  return {
    default: Object.assign(Anthropic, {
      APIError,
      AuthenticationError,
      PermissionDeniedError,
      RateLimitError,
      NotFoundError,
      BadRequestError,
      APIConnectionTimeoutError,
    }),
  };
});

const { createAnthropicAsk } = await import("./anthropic");

const CONFIG: ProviderConfig = {
  source: "platform",
  provider: "anthropic",
  model: "modele-de-la-plateforme",
  baseUrl: null,
  apiKey: "clef-de-la-plateforme",
};

const REQUEST: ModelRequest = { system: "Tu es le coach.", maxTokens: 300 };

beforeEach(() => {
  state.reply = { content: [{ type: "text", text: "" }], stop_reason: "end_turn" };
});

describe("createAnthropicAsk", () => {
  it("rend le texte d'une réponse terminée, sans la dire coupée", async () => {
    state.reply = {
      content: [{ type: "text", text: "  Deux phrases, et elles tiennent.  " }],
      stop_reason: "end_turn",
    };

    const ask = createAnthropicAsk(CONFIG, REQUEST);

    await expect(ask([{ role: "user", content: "x" }], 5000)).resolves.toEqual({
      text: "Deux phrases, et elles tiennent.",
      truncated: false,
    });
  });

  it("signale la troncature quand le plafond de jetons est tombé en cours d'écriture", async () => {
    state.reply = {
      content: [{ type: "text", text: "Tu meurs trop tôt en post-plant, replace-toi der" }],
      stop_reason: "max_tokens",
    };

    const ask = createAnthropicAsk(CONFIG, REQUEST);
    const answer = await ask([{ role: "user", content: "x" }], 5000);

    // Le texte reste rendu : c'est la police d'en haut qui décide quoi en faire.
    expect(answer.text).toContain("post-plant");
    expect(answer.truncated).toBe(true);
  });

  it("refuse une réponse sans texte, comme avant", async () => {
    state.reply = { content: [{ type: "thinking" }], stop_reason: "end_turn" };

    const ask = createAnthropicAsk(CONFIG, REQUEST);

    await expect(ask([{ role: "user", content: "x" }], 5000)).rejects.toMatchObject({
      kind: "malformed",
    });
  });
});
