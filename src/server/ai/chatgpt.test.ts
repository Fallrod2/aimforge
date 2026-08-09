/**
 * L'adaptateur ChatGPT parle à un back-end non documenté : sa lecture doit
 * survivre à plusieurs formes de réponse, et c'est exactement ce qui se teste
 * ici. `readResponsesPayload` est pur — le jour où OpenAI change l'emballage,
 * c'est ce fichier qui dira lequel des trois chemins tient encore.
 */

import { describe, expect, it } from "vitest";
import { createChatGptAsk, readResponsesPayload } from "./chatgpt";
import { ModelError, type ModelRequest, type ProviderConfig } from "./port";

const CONFIG: ProviderConfig = {
  source: "user",
  provider: "chatgpt_subscription",
  model: "gpt-5",
  baseUrl: null,
  apiKey: "jeton-de-session",
};

const REQUEST: ModelRequest = { system: "Tu es le coach.", maxTokens: 2000 };

describe("readResponsesPayload", () => {
  it("recolle les deltas d'un flux d'évènements", () => {
    const raw = [
      'data: {"type":"response.output_text.delta","delta":"{\\"a\\":"}',
      'data: {"type":"response.output_text.delta","delta":"1}"}',
      "data: [DONE]",
      "",
    ].join("\n");

    expect(readResponsesPayload(raw)).toBe('{"a":1}');
  });

  it("préfère le texte de l'évènement final quand il existe", () => {
    const raw = [
      'data: {"type":"response.output_text.delta","delta":"partiel"}',
      'data: {"type":"response.completed","response":{"output_text":"complet"}}',
      "",
    ].join("\n");

    expect(readResponsesPayload(raw)).toBe("complet");
  });

  it("sait lire le texte à travers `output[].content[]`", () => {
    const raw =
      'data: {"type":"response.completed","response":{"output":[{"content":[{"type":"output_text","text":"{\\"ok\\":true}"}]}]}}\n';

    expect(readResponsesPayload(raw)).toBe('{"ok":true}');
  });

  it("accepte aussi un corps JSON d'un seul tenant", () => {
    expect(readResponsesPayload(JSON.stringify({ output_text: "sans flux" }))).toBe("sans flux");
  });

  it("ignore les lignes illisibles plutôt que d'abandonner", () => {
    const raw = ['data: {"type":"garb', 'data: {"delta":"utile"}', ""].join("\n");

    expect(readResponsesPayload(raw)).toBe("utile");
  });

  it("rend null quand il n'y a rien à lire", () => {
    expect(readResponsesPayload("")).toBeNull();
    expect(readResponsesPayload("data: [DONE]\n")).toBeNull();
  });
});

describe("createChatGptAsk", () => {
  it("envoie le prompt système en `instructions` et n'enregistre rien chez OpenAI", async () => {
    let sent: Record<string, unknown> = {};
    const ask = createChatGptAsk(CONFIG, REQUEST, async (_url, init) => {
      sent = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response('data: {"delta":"ok"}\n');
    });

    await ask([{ role: "user", content: "stats" }], 5000);

    expect(sent.instructions).toBe("Tu es le coach.");
    expect(sent.model).toBe("gpt-5");
    expect(sent.store).toBe(false);
  });

  it("traduit un jeton expiré en défaut d'authentification de la config perso", async () => {
    const ask = createChatGptAsk(
      CONFIG,
      REQUEST,
      async () => new Response("<html>forbidden</html>", { status: 401 }),
    );

    await expect(ask([{ role: "user", content: "x" }], 5000)).rejects.toMatchObject({
      kind: "auth",
      custom: true,
    });
  });

  it("traduit la limite d'abonnement", async () => {
    const ask = createChatGptAsk(CONFIG, REQUEST, async () => new Response("", { status: 429 }));

    await expect(ask([{ role: "user", content: "x" }], 5000)).rejects.toMatchObject({
      kind: "rate_limit",
    });
  });

  it("signale une réponse illisible plutôt que de rendre du vide", async () => {
    const ask = createChatGptAsk(CONFIG, REQUEST, async () => new Response("bonjour"));
    const error = await ask([{ role: "user", content: "x" }], 5000).catch((cause) => cause);

    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).kind).toBe("malformed");
  });
});

describe("createChatGptAsk — redirections", () => {
  it("ne suit pas les redirections et les refuse", async () => {
    let init: RequestInit = {};
    const ask = createChatGptAsk(CONFIG, REQUEST, async (_url, received) => {
      init = received;
      return new Response(null, { status: 307, headers: { location: "http://10.0.0.5/" } });
    });
    const error = await ask([{ role: "user", content: "x" }], 5000).catch((cause) => cause);

    expect(init.redirect).toBe("manual");
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).kind).toBe("redirect");
  });
});
