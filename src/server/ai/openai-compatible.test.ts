/**
 * `fetch` est remplacé par un faux : ces tests vérifient la **forme** de ce
 * qu'on envoie à un serveur `/chat/completions` et la traduction de ce qu'il
 * répond. Aucun appel réseau, donc aucune clé et aucun quota consommé — et
 * surtout, les cas qui comptent (401, 429, 400 sur `max_tokens`) sont ceux
 * qu'on ne sait pas provoquer à la demande sur un vrai fournisseur.
 */

import { describe, expect, it } from "vitest";
import {
  chatEndpoint,
  createChatAsk,
  type FetchLike,
  readChatCompletion,
} from "./openai-compatible";
import { ModelError, type ModelRequest, type ProviderConfig } from "./port";

const REQUEST: ModelRequest = { system: "Tu es le coach.", maxTokens: 2000 };

const MISTRAL: ProviderConfig = {
  source: "user",
  provider: "mistral",
  model: "mistral-large-latest",
  baseUrl: null,
  apiKey: "cle-secrete-utilisateur",
};

interface Recorder {
  readonly fetch: FetchLike;
  readonly calls: { url: string; init: RequestInit }[];
}

/** Un faux `fetch` qui déroule des réponses préparées et note ce qu'on lui a demandé. */
function recorder(responses: readonly Response[]): Recorder {
  const calls: { url: string; init: RequestInit }[] = [];
  let index = 0;

  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const response = responses[index];

      index += 1;
      if (response === undefined) throw new Error("appel inattendu");
      return response;
    },
  };
}

function completion(text: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status });
}

function body(call: { init: RequestInit }): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

describe("chatEndpoint", () => {
  it("connaît le point d'entrée de Mistral", () => {
    expect(chatEndpoint(MISTRAL).url).toBe("https://api.mistral.ai/v1/chat/completions");
  });

  it("connaît celui d'OpenRouter et s'y identifie", () => {
    const endpoint = chatEndpoint({ ...MISTRAL, provider: "openrouter" });

    expect(endpoint.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(endpoint.headers["X-Title"]).toBe("AimForge");
  });

  it("complète l'URL de base d'un serveur OpenAI-compatible", () => {
    const endpoint = chatEndpoint({
      ...MISTRAL,
      provider: "openai_compatible",
      baseUrl: "https://api.exemple.com/v1",
    });

    expect(endpoint.url).toBe("https://api.exemple.com/v1/chat/completions");
  });

  it("porte la clé en Bearer", () => {
    expect(chatEndpoint(MISTRAL).headers.authorization).toBe("Bearer cle-secrete-utilisateur");
  });

  it("refuse une URL de base inutilisable, sans appeler personne", () => {
    expect(() =>
      chatEndpoint({ ...MISTRAL, provider: "openai_compatible", baseUrl: "http://127.0.0.1/v1" }),
    ).toThrow(ModelError);
  });
});

describe("readChatCompletion", () => {
  it("lit un contenu texte", () => {
    expect(readChatCompletion({ choices: [{ message: { content: ' {"a":1} ' } }] })).toBe(
      '{"a":1}',
    );
  });

  it("lit un contenu découpé en blocs", () => {
    const payload = {
      choices: [{ message: { content: [{ type: "text", text: '{"a":' }, { text: "1}" }] } }],
    };

    expect(readChatCompletion(payload)).toBe('{"a":1}');
  });

  it("rend null quand il n'y a pas de choix", () => {
    expect(readChatCompletion({ choices: [] })).toBeNull();
    expect(readChatCompletion({})).toBeNull();
    expect(readChatCompletion(null)).toBeNull();
  });

  it("rend null sur un contenu vide", () => {
    expect(readChatCompletion({ choices: [{ message: { content: "   " } }] })).toBeNull();
  });
});

describe("createChatAsk — la requête", () => {
  it("met le prompt système en tête, puis la conversation", async () => {
    const fake = recorder([completion("{}")]);
    const ask = createChatAsk(MISTRAL, REQUEST, fake.fetch);

    await ask([{ role: "user", content: "Voici mes stats" }], 5000);

    const sent = body(fake.calls[0] as { init: RequestInit });

    expect(sent.model).toBe("mistral-large-latest");
    expect(sent.max_tokens).toBe(2000);
    expect(sent.messages).toEqual([
      { role: "system", content: "Tu es le coach." },
      { role: "user", content: "Voici mes stats" },
    ]);
  });

  it("rend le texte de la réponse, détouré", async () => {
    const fake = recorder([completion('  {"resume":"ok"}  ')]);
    const ask = createChatAsk(MISTRAL, REQUEST, fake.fetch);

    await expect(ask([{ role: "user", content: "x" }], 5000)).resolves.toBe('{"resume":"ok"}');
  });
});

describe("createChatAsk — erreurs traduites", () => {
  async function failWith(status: number, payload = "{}"): Promise<ModelError> {
    const fake = recorder([new Response(payload, { status })]);
    const ask = createChatAsk(MISTRAL, REQUEST, fake.fetch);

    try {
      await ask([{ role: "user", content: "x" }], 5000);
    } catch (cause) {
      return cause as ModelError;
    }
    throw new Error("aucune erreur levée");
  }

  it("traduit un 401 en défaut d'authentification", async () => {
    const error = await failWith(401);

    expect(error).toBeInstanceOf(ModelError);
    expect(error.kind).toBe("auth");
    expect(error.custom).toBe(true);
  });

  it("traduit un 429 en limite atteinte", async () => {
    expect((await failWith(429)).kind).toBe("rate_limit");
  });

  it("traduit un 402 (crédit épuisé) comme une limite, pas comme une panne", async () => {
    expect((await failWith(402)).kind).toBe("rate_limit");
  });

  it("traduit un 500 en service injoignable", async () => {
    expect((await failWith(503)).kind).toBe("unreachable");
  });

  it("traduit un 400 en requête refusée", async () => {
    expect((await failWith(400, '{"error":"unknown model"}')).kind).toBe("request");
  });

  it("ne laisse jamais la clé fuiter dans le message d'erreur", async () => {
    const error = await failWith(401, '{"error":"invalid api key cle-secrete-utilisateur"}');

    expect(error.message).not.toContain("cle-secrete-utilisateur");
  });

  it("signale une réponse sans texte", async () => {
    const fake = recorder([new Response(JSON.stringify({ choices: [] }), { status: 200 })]);
    const ask = createChatAsk(MISTRAL, REQUEST, fake.fetch);

    await expect(ask([{ role: "user", content: "x" }], 5000)).rejects.toMatchObject({
      kind: "malformed",
    });
  });

  it("marque `custom: false` pour la configuration de la plateforme", async () => {
    const fake = recorder([new Response("{}", { status: 401 })]);
    const ask = createChatAsk({ ...MISTRAL, source: "platform" }, REQUEST, fake.fetch);

    await expect(ask([{ role: "user", content: "x" }], 5000)).rejects.toMatchObject({
      custom: false,
    });
  });
});

describe("createChatAsk — `max_completion_tokens`", () => {
  it("rejoue une fois quand le fournisseur réclame l'autre nom de paramètre", async () => {
    const refusal = new Response(
      JSON.stringify({
        error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens'." },
      }),
      { status: 400 },
    );
    const fake = recorder([refusal, completion("{}")]);
    const ask = createChatAsk(MISTRAL, REQUEST, fake.fetch);

    await expect(ask([{ role: "user", content: "x" }], 5000)).resolves.toBe("{}");
    expect(fake.calls).toHaveLength(2);
    expect(body(fake.calls[0] as { init: RequestInit })).toHaveProperty("max_tokens");

    const second = body(fake.calls[1] as { init: RequestInit });

    expect(second.max_completion_tokens).toBe(2000);
    expect(second).not.toHaveProperty("max_tokens");
  });

  it("ne rejoue pas un 400 ordinaire", async () => {
    const fake = recorder([new Response('{"error":"bad model"}', { status: 400 })]);
    const ask = createChatAsk(MISTRAL, REQUEST, fake.fetch);

    await expect(ask([{ role: "user", content: "x" }], 5000)).rejects.toBeInstanceOf(ModelError);
    expect(fake.calls).toHaveLength(1);
  });
});

/**
 * PoC de la revue adversariale : une redirection suivie annule la vérification
 * de `checkBaseUrl`. Un serveur autorisé (nom de domaine public) répond 302
 * vers `http://169.254.169.254/…` et c'est **notre** fonction qui va la
 * chercher — l'URL validée n'était que la première d'une chaîne.
 */
describe("createChatAsk — redirections", () => {
  it("demande à `fetch` de ne pas suivre les redirections", async () => {
    const fake = recorder([completion("{}")]);
    const ask = createChatAsk(MISTRAL, REQUEST, fake.fetch);

    await ask([{ role: "user", content: "x" }], 5000);
    expect((fake.calls[0] as { init: RequestInit }).init.redirect).toBe("manual");
  });

  it("refuse un 3xx au lieu de le suivre", async () => {
    const fake = recorder([
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }),
    ]);
    const ask = createChatAsk(MISTRAL, REQUEST, fake.fetch);
    const error = await ask([{ role: "user", content: "x" }], 5000).catch((cause) => cause);

    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).kind).toBe("redirect");
    expect(fake.calls).toHaveLength(1);
  });
});
