/**
 * L'adaptateur ChatGPT parle à un back-end non documenté : sa lecture doit
 * survivre à plusieurs formes de réponse, et c'est exactement ce qui se teste
 * ici. `readResponsesPayload` est pur — le jour où OpenAI change l'emballage,
 * c'est ce fichier qui dira lequel des trois chemins tient encore.
 */

import { describe, expect, it } from "vitest";
import { createChatGptAsk, readResponsesPayload } from "./chatgpt";
import { OAUTH_TOKEN_URL } from "./codex-oauth";
import {
  ModelError,
  type ModelRequest,
  modelErrorMessage,
  modelTestMessage,
  type ProviderConfig,
} from "./port";

/** Un JWT de façade : seule sa charge utile est lue (jamais sa signature). */
function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${part({ alg: "none" })}.${part(claims)}.signature`;
}

const HOUR_MS = 60 * 60 * 1000;

/** Le groupe de jetons tel qu'il est stocké, avec une échéance choisie. */
function bundle(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    access_token: "acces-en-cours",
    refresh_token: "rafraichissement",
    expires_at: new Date(Date.now() + HOUR_MS).toISOString(),
    account_id: "compte-1",
    ...overrides,
  });
}

const CONFIG: ProviderConfig = {
  source: "user",
  provider: "chatgpt_subscription",
  model: "gpt-5",
  baseUrl: null,
  apiKey: bundle(),
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
    let headers: Headers = new Headers();
    const ask = createChatGptAsk(CONFIG, REQUEST, {
      fetchImpl: async (_url, init) => {
        sent = JSON.parse(String(init.body)) as Record<string, unknown>;
        headers = new Headers(init.headers);
        return new Response('data: {"delta":"ok"}\n');
      },
    });

    await ask([{ role: "user", content: "stats" }], 5000);

    expect(sent.instructions).toBe("Tu es le coach.");
    expect(sent.model).toBe("gpt-5");
    expect(sent.store).toBe(false);
    // Le back-end refuse ce paramètre (400 « Unsupported parameter ») : il ne
    // doit jamais repartir dans le corps.
    expect(sent).not.toHaveProperty("max_output_tokens");
    // Le jeton d'accès du groupe, et l'identifiant de compte que le back-end exige.
    expect(headers.get("authorization")).toBe("Bearer acces-en-cours");
    expect(headers.get("chatgpt-account-id")).toBe("compte-1");
    expect(headers.get("originator")).toBe("codex_cli_rs");
  });

  it("traduit un jeton expiré en défaut d'authentification de la config perso", async () => {
    const ask = createChatGptAsk(CONFIG, REQUEST, {
      fetchImpl: async () => new Response("<html>forbidden</html>", { status: 401 }),
    });

    await expect(ask([{ role: "user", content: "x" }], 5000)).rejects.toMatchObject({
      kind: "auth",
      custom: true,
    });
  });

  it("traduit la limite d'abonnement", async () => {
    const ask = createChatGptAsk(CONFIG, REQUEST, {
      fetchImpl: async () => new Response("", { status: 429 }),
    });

    await expect(ask([{ role: "user", content: "x" }], 5000)).rejects.toMatchObject({
      kind: "rate_limit",
    });
  });

  it("signale une réponse illisible plutôt que de rendre du vide", async () => {
    const ask = createChatGptAsk(CONFIG, REQUEST, {
      fetchImpl: async () => new Response("bonjour"),
    });
    const error = await ask([{ role: "user", content: "x" }], 5000).catch((cause) => cause);

    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).kind).toBe("malformed");
  });
});

describe("createChatGptAsk — redirections", () => {
  it("ne suit pas les redirections et les refuse", async () => {
    let init: RequestInit = {};
    const ask = createChatGptAsk(CONFIG, REQUEST, {
      fetchImpl: async (_url, received) => {
        init = received;
        return new Response(null, { status: 307, headers: { location: "http://10.0.0.5/" } });
      },
    });
    const error = await ask([{ role: "user", content: "x" }], 5000).catch((cause) => cause);

    expect(init.redirect).toBe("manual");
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).kind).toBe("redirect");
  });
});

/**
 * Le rafraîchissement est la moitié invisible de ce fournisseur : sans lui, une
 * liaison cesserait de marcher au bout de quelques heures et l'utilisateur
 * n'aurait aucun moyen de le comprendre. Ces cas décrivent exactement ce qui
 * doit arriver quand le jeton d'accès n'est plus bon — y compris les deux
 * situations qu'il ne faut surtout pas confondre : « OpenAI a révoqué la
 * liaison » (il faut relier) et « OpenAI n'a pas répondu » (il faut réessayer).
 */
describe("createChatGptAsk — rafraîchissement des jetons", () => {
  /** Un `fetch` qui distingue l'hôte d'autorisation du back-end de génération. */
  function routed(handlers: {
    readonly oauth: () => Response;
    readonly backend?: (init: RequestInit) => Response;
  }) {
    const calls = { oauth: 0, backend: 0 };
    const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
      if (url === OAUTH_TOKEN_URL) {
        calls.oauth += 1;
        return handlers.oauth();
      }
      calls.backend += 1;
      return (handlers.backend ?? (() => new Response('data: {"delta":"ok"}\n')))(init);
    };

    return { calls, fetchImpl };
  }

  const EXPIRED = bundle({ expires_at: new Date(Date.now() - HOUR_MS).toISOString() });

  it("renouvelle un jeton expiré, réécrit le groupe et appelle avec le neuf", async () => {
    let authorization: string | null = null;
    let written = "";
    const routes = routed({
      oauth: () =>
        Response.json({
          access_token: jwt({ exp: Math.floor((Date.now() + HOUR_MS) / 1000) }),
          refresh_token: "rafraichissement-2",
        }),
      backend: (init) => {
        authorization = new Headers(init.headers).get("authorization");
        return new Response('data: {"delta":"ok"}\n');
      },
    });
    const ask = createChatGptAsk({ ...CONFIG, apiKey: EXPIRED }, REQUEST, {
      fetchImpl: routes.fetchImpl,
      persist: async (value) => {
        written = value;
      },
    });

    expect(await ask([{ role: "user", content: "x" }], 5000)).toBe("ok");
    expect(routes.calls.oauth).toBe(1);
    expect(authorization).not.toBe("Bearer acces-en-cours");

    const kept = JSON.parse(written) as Record<string, unknown>;

    expect(kept.refresh_token).toBe("rafraichissement-2");
    // L'identifiant de compte n'est pas renvoyé au rafraîchissement : le perdre
    // ferait échouer tous les appels suivants.
    expect(kept.account_id).toBe("compte-1");
  });

  it("garde l'ancien jeton de rafraîchissement quand OpenAI n'en renvoie pas", async () => {
    let written = "";
    const routes = routed({
      oauth: () => Response.json({ access_token: "acces-neuf", expires_in: 3600 }),
    });
    const ask = createChatGptAsk({ ...CONFIG, apiKey: EXPIRED }, REQUEST, {
      fetchImpl: routes.fetchImpl,
      persist: async (value) => {
        written = value;
      },
    });

    await ask([{ role: "user", content: "x" }], 5000);
    expect((JSON.parse(written) as Record<string, unknown>).refresh_token).toBe("rafraichissement");
  });

  it("un rafraîchissement refusé demande de relier le compte", async () => {
    const routes = routed({ oauth: () => new Response("", { status: 400 }) });
    const ask = createChatGptAsk({ ...CONFIG, apiKey: EXPIRED }, REQUEST, {
      fetchImpl: routes.fetchImpl,
    });
    const error = await ask([{ role: "user", content: "x" }], 5000).catch((cause) => cause);

    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).kind).toBe("auth");
    // Le back-end n'est jamais appelé avec un jeton qu'on sait mort.
    expect(routes.calls.backend).toBe(0);
    expect(modelErrorMessage(error as ModelError, "coach")).toContain("relie ton compte ChatGPT");
  });

  it("une panne de l'hôte d'autorisation ne délie personne : l'appel est tenté", async () => {
    // Jeton encore valable quelques minutes : on est dans la marge, pas expiré.
    const soon = bundle({ expires_at: new Date(Date.now() + 60_000).toISOString() });
    const routes = routed({ oauth: () => new Response("", { status: 503 }) });
    const ask = createChatGptAsk({ ...CONFIG, apiKey: soon }, REQUEST, {
      fetchImpl: routes.fetchImpl,
    });

    expect(await ask([{ role: "user", content: "x" }], 5000)).toBe("ok");
    expect(routes.calls.backend).toBe(1);
  });

  it("une panne de l'hôte d'autorisation sur un jeton mort reste une panne, pas un refus", async () => {
    const routes = routed({ oauth: () => new Response("", { status: 503 }) });
    const ask = createChatGptAsk({ ...CONFIG, apiKey: EXPIRED }, REQUEST, {
      fetchImpl: routes.fetchImpl,
    });
    const error = await ask([{ role: "user", content: "x" }], 5000).catch((cause) => cause);

    expect((error as ModelError).kind).toBe("unreachable");
  });

  it("un groupe illisible (clé collée d'une version antérieure) demande de relier", async () => {
    const routes = routed({ oauth: () => new Response("", { status: 500 }) });
    const ask = createChatGptAsk({ ...CONFIG, apiKey: "sk-une-vieille-cle" }, REQUEST, {
      fetchImpl: routes.fetchImpl,
    });
    const error = await ask([{ role: "user", content: "x" }], 5000).catch((cause) => cause);

    expect((error as ModelError).kind).toBe("auth");
    expect(routes.calls.backend).toBe(0);
    expect(modelTestMessage(error as ModelError)).toContain("relie ton compte ChatGPT");
  });

  it("une réécriture en échec n'empêche pas l'appel en cours", async () => {
    const routes = routed({
      oauth: () => Response.json({ access_token: "acces-neuf", expires_in: 3600 }),
    });
    const ask = createChatGptAsk({ ...CONFIG, apiKey: EXPIRED }, REQUEST, {
      fetchImpl: routes.fetchImpl,
      persist: async () => {
        throw new Error("permission denied");
      },
    });

    expect(await ask([{ role: "user", content: "x" }], 5000)).toBe("ok");
  });
});
