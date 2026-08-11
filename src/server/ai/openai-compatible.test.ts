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
  connectBudget,
  createChatAsk,
  cutAtCap,
  type FetchLike,
  readChatCompletion,
  spentOnReasoning,
} from "./openai-compatible";
import {
  ModelError,
  type ModelRequest,
  modelErrorMessage,
  modelErrorStatus,
  type ProviderConfig,
} from "./port";

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

/** Une complétion coupée au plafond de jetons : du texte, et `length` au bout. */
function cutCompletion(text: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "length" }] }),
    { status: 200 },
  );
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

  it("rend le texte de la réponse, détouré, et ne la dit pas coupée", async () => {
    const fake = recorder([completion('  {"resume":"ok"}  ')]);
    const ask = createChatAsk(MISTRAL, REQUEST, fake.fetch);

    await expect(ask([{ role: "user", content: "x" }], 5000)).resolves.toEqual({
      text: '{"resume":"ok"}',
      truncated: false,
    });
  });
});

/**
 * Une sortie coupée au plafond n'est ni vide ni malformée : elle est
 * **plausible**. Le seul témoin est `finish_reason`, et il ne se déduit de rien
 * d'autre — d'où sa remontée jusqu'aux polices.
 */
describe("createChatAsk — sortie coupée au plafond", () => {
  it("reconnaît `length` sur un contenu non vide", () => {
    expect(
      cutAtCap({
        choices: [{ message: { content: "une phrase en pl" }, finish_reason: "length" }],
      }),
    ).toBe(true);
  });

  it("ne signale rien sur une génération terminée", () => {
    expect(cutAtCap({ choices: [{ message: { content: "fini" }, finish_reason: "stop" }] })).toBe(
      false,
    );
    expect(cutAtCap({ choices: [] })).toBe(false);
    expect(cutAtCap(null)).toBe(false);
  });

  it("remonte la troncature avec le texte, sans en faire une erreur", async () => {
    const fake = recorder([cutCompletion("Tu meurs trop tôt en post-plant, replace-toi der")]);
    const ask = createChatAsk(MISTRAL, REQUEST, fake.fetch);
    const answer = await ask([{ role: "user", content: "x" }], 5000);

    expect(answer.text).toContain("post-plant");
    expect(answer.truncated).toBe(true);
  });

  it("laisse le contenu vide au diagnostic de raisonnement, qui reste une erreur", async () => {
    const fake = recorder([
      new Response(
        JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "length" }] }),
        { status: 200 },
      ),
    ]);
    const ask = createChatAsk(MISTRAL, REQUEST, fake.fetch);

    await expect(ask([{ role: "user", content: "x" }], 5000)).rejects.toMatchObject({
      kind: "reasoning_budget",
    });
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

  /**
   * Le cas OpenRouter de la production : `200`, puis une lecture du corps qui
   * dépasse notre budget. Le fournisseur a répondu — le classer en `malformed`
   * faisait afficher « Le coach est injoignable », ce qui était faux deux fois.
   */
  it("distingue un corps trop lent d'un corps illisible", async () => {
    const stalled = new Response(
      new ReadableStream({
        pull() {
          throw new DOMException("délai de lecture dépassé", "TimeoutError");
        },
      }),
      { status: 200 },
    );
    const ask = createChatAsk(MISTRAL, REQUEST, recorder([stalled]).fetch);

    await expect(ask([{ role: "user", content: "x" }], 5000)).rejects.toMatchObject({
      kind: "timeout",
      status: 200,
    });
  });

  it("garde `malformed` pour un corps qui n'est pas du JSON", async () => {
    const ask = createChatAsk(
      MISTRAL,
      REQUEST,
      recorder([new Response("<html>", { status: 200 })]).fetch,
    );

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

    await expect(ask([{ role: "user", content: "x" }], 5000)).resolves.toMatchObject({
      text: "{}",
    });
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

/**
 * Un modèle raisonneur (`deepseek/deepseek-v4-flash-0731` en production) rend
 * un `200` parfaitement formé, mais vide : tout le budget est passé dans
 * `reasoning`. Confondre ce cas avec « réponse illisible » envoyait chercher
 * une incompatibilité de format là où il n'y a qu'un budget mal réparti.
 */
describe("spentOnReasoning", () => {
  /** La forme réelle : contenu vide, raisonnement rempli, troncature au plafond. */
  const REASONED = {
    choices: [
      {
        message: { role: "assistant", content: "", reasoning: "Analysons les scores…" },
        finish_reason: "length",
      },
    ],
  };

  it("reconnaît un budget parti en raisonnement", () => {
    expect(spentOnReasoning(REASONED)).toBe(true);
  });

  it("se contente de la troncature quand le raisonnement n'est pas renvoyé", () => {
    const hidden = { choices: [{ message: { content: "" }, finish_reason: "length" }] };

    expect(spentOnReasoning(hidden)).toBe(true);
  });

  it("accepte les autres noms du champ", () => {
    const deepseek = {
      choices: [{ message: { content: null, reasoning_content: "…" }, finish_reason: "stop" }],
    };

    expect(spentOnReasoning(deepseek)).toBe(true);
  });

  it("ne diagnostique rien quand il y a un texte à lire", () => {
    const answered = {
      choices: [{ message: { content: '{"a":1}', reasoning: "…" }, finish_reason: "length" }],
    };

    expect(spentOnReasoning(answered)).toBe(false);
  });

  it("ne diagnostique rien sur un vide ordinaire", () => {
    expect(spentOnReasoning({ choices: [] })).toBe(false);
    expect(
      spentOnReasoning({ choices: [{ message: { content: "" }, finish_reason: "stop" }] }),
    ).toBe(false);
    expect(spentOnReasoning(null)).toBe(false);
  });

  it("remonte comme un genre à part, avec un message qui nomme la cause", async () => {
    const fake = recorder([new Response(JSON.stringify(REASONED), { status: 200 })]);
    const ask = createChatAsk({ ...MISTRAL, provider: "openrouter" }, REQUEST, fake.fetch);
    const error = (await ask([{ role: "user", content: "x" }], 5000).catch(
      (cause) => cause,
    )) as ModelError;

    expect(error.kind).toBe("reasoning_budget");
    expect(modelErrorStatus(error)).toBe(409);
    expect(modelErrorMessage(error, "coach")).toContain("raisonnement interne");
  });
});

/**
 * `reasoning` est un paramètre **d'OpenRouter** : l'envoyer ailleurs, c'est
 * risquer un 400 sur un appel qui marchait.
 */
describe("createChatAsk — désactivation du raisonnement", () => {
  it("demande à OpenRouter de ne pas raisonner", async () => {
    const fake = recorder([completion("{}")]);
    const ask = createChatAsk({ ...MISTRAL, provider: "openrouter" }, REQUEST, fake.fetch);

    await ask([{ role: "user", content: "x" }], 5000);
    expect(body(fake.calls[0] as { init: RequestInit }).reasoning).toEqual({ effort: "none" });
  });

  it("ne l'envoie ni à Mistral ni à un serveur OpenAI-compatible", async () => {
    for (const config of [
      MISTRAL,
      { ...MISTRAL, provider: "openai_compatible" as const, baseUrl: "https://api.exemple.com/v1" },
    ]) {
      const fake = recorder([completion("{}")]);
      const ask = createChatAsk(config, REQUEST, fake.fetch);

      await ask([{ role: "user", content: "x" }], 5000);
      expect(body(fake.calls[0] as { init: RequestInit })).not.toHaveProperty("reasoning");
    }
  });
});

/**
 * Le partage du délai est de l'arithmétique, et c'est ce qui le rend testable :
 * la lecture doit recevoir davantage que l'établissement de l'appel, sans que
 * la somme dépasse le budget que le port a confié à l'adaptateur.
 */
describe("connectBudget", () => {
  it("laisse la plus grosse part à la lecture du corps", () => {
    for (const total of [5_000, 20_000, 45_000, 48_000]) {
      const connect = connectBudget(total);

      expect(connect).toBeGreaterThan(0);
      expect(connect).toBeLessThan(total - connect);
    }
  });

  it("reste positif sur un budget minuscule", () => {
    expect(connectBudget(1)).toBe(1);
    expect(connectBudget(0)).toBe(1);
  });
});
