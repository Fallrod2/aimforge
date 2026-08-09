/**
 * La machine d'état de la liaison, jouée de bout en bout **sans compte
 * ChatGPT** : `fetch` est simulé, l'heure est injectée. C'est ce qui permet de
 * décrire ce qu'aucun parcours réel ne montrerait à la demande — un compte où
 * la connexion par code est désactivée, une panne d'OpenAI, un refus, un jeton
 * opaque présenté par le mauvais utilisateur.
 *
 * Le contrat que ces cas tiennent, et qui n'a rien de théorique : **aucun jeton
 * ne sort de la machine autrement que par `bundle`**, qui est destiné à la base
 * et jamais à une réponse HTTP.
 */

import { describe, expect, it } from "vitest";
import { pollLink, startLink } from "./codex-link";
import { DEVICE_TOKEN_URL, OAUTH_TOKEN_URL, USERCODE_URL } from "./codex-oauth";
import type { FetchLike } from "./openai-compatible";

const SECRET = "clé-de-scellement";
const NOW = Date.parse("2026-08-09T12:00:00.000Z");
const USER = "utilisateur-a";

function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${part({ alg: "none" })}.${part(claims)}.signature`;
}

/**
 * Le triple d'OpenAI, réduit à ce que le flux touche. `usercode` ouvre la
 * demande, `deviceToken` dit où elle en est, `oauth` échange le code.
 */
function openAi(overrides: {
  readonly usercode?: () => Response;
  readonly deviceToken?: () => Response;
  readonly oauth?: () => Response;
}): { readonly fetchImpl: FetchLike; readonly seen: string[] } {
  const seen: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    seen.push(url);
    if (url === USERCODE_URL) {
      return (
        overrides.usercode?.() ??
        // `interval` arrive en chaîne côté OpenAI : le simuler autrement
        // masquerait le seul piège de ce corps de réponse.
        Response.json({ device_auth_id: "dev-1", user_code: "ABCD-1234", interval: "5" })
      );
    }
    if (url === DEVICE_TOKEN_URL) {
      return (
        overrides.deviceToken?.() ??
        Response.json({ authorization_code: "code-1", code_verifier: "verifieur-1" })
      );
    }
    if (url === OAUTH_TOKEN_URL) {
      return (
        overrides.oauth?.() ??
        Response.json({
          access_token: jwt({ exp: Math.floor((NOW + 3_600_000) / 1000) }),
          refresh_token: "rafraichissement-1",
          id_token: jwt({ chatgpt_account_id: "acct-1" }),
        })
      );
    }
    return new Response("", { status: 404 });
  };

  return { fetchImpl, seen };
}

describe("startLink", () => {
  it("rend le code à saisir, la page à ouvrir, et un jeton opaque", async () => {
    const { fetchImpl, seen } = openAi({});
    const outcome = await startLink(USER, { secret: SECRET, fetchImpl, now: NOW });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.link.userCode).toBe("ABCD-1234");
    expect(outcome.link.verificationUri).toContain("openai.com");
    expect(outcome.link.expiresIn).toBe(15 * 60);
    expect(outcome.link.handle).toContain(".");
    // Le préfixe `/api/accounts` est la seule URL d'initialisation qui marche.
    expect(seen[0]).toContain("/api/accounts/deviceauth/usercode");
  });

  it("ne laisse fuir ni l'identifiant interne de la demande, ni un secret", async () => {
    const { fetchImpl } = openAi({});
    const outcome = await startLink(USER, { secret: SECRET, fetchImpl, now: NOW });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Le jeton opaque est scellé : `dev-1` n'y est pas lisible en clair.
    expect(JSON.stringify(outcome.link)).not.toContain("dev-1");
  });

  it("dit « connexion par code désactivée » sur un 404, et seulement là", async () => {
    const { fetchImpl } = openAi({ usercode: () => new Response("", { status: 404 }) });
    const outcome = await startLink(USER, { secret: SECRET, fetchImpl, now: NOW });

    expect(outcome).toMatchObject({ ok: false, status: 503 });
    if (outcome.ok) return;
    expect(outcome.reason).toContain("Sécurité");
  });

  it("dit « panne » sur un 500 : accuser le réglage du compte serait un faux diagnostic", async () => {
    const { fetchImpl } = openAi({ usercode: () => new Response("", { status: 500 }) });
    const outcome = await startLink(USER, { secret: SECRET, fetchImpl, now: NOW });

    expect(outcome).toMatchObject({ ok: false, status: 502 });
    if (outcome.ok) return;
    expect(outcome.reason).not.toContain("Sécurité");
  });

  it("traite un 200 inexploitable comme une panne, pas comme un compte mal réglé", async () => {
    const { fetchImpl } = openAi({ usercode: () => Response.json({ user_code: "ABCD" }) });

    expect(await startLink(USER, { secret: SECRET, fetchImpl, now: NOW })).toMatchObject({
      ok: false,
      status: 502,
    });
  });
});

describe("pollLink", () => {
  async function handleFor(fetchImpl: FetchLike): Promise<string> {
    const started = await startLink(USER, { secret: SECRET, fetchImpl, now: NOW });

    if (!started.ok) throw new Error("initialisation en échec");
    return started.link.handle;
  }

  it("attend tant que l'utilisateur n'a pas autorisé (403 et 404 d'OpenAI)", async () => {
    for (const status of [403, 404]) {
      const { fetchImpl } = openAi({ deviceToken: () => new Response("", { status }) });
      const handle = await handleFor(fetchImpl);

      expect(await pollLink(USER, handle, { secret: SECRET, fetchImpl, now: NOW })).toEqual({
        status: "pending",
      });
    }
  });

  it("échange le code côté serveur et rend le groupe de jetons à écrire", async () => {
    const { fetchImpl, seen } = openAi({});
    const handle = await handleFor(fetchImpl);
    const outcome = await pollLink(USER, handle, { secret: SECRET, fetchImpl, now: NOW });

    expect(outcome.status).toBe("linked");
    if (outcome.status !== "linked") return;

    const bundle = JSON.parse(outcome.bundle) as Record<string, unknown>;

    expect(bundle.refresh_token).toBe("rafraichissement-1");
    expect(bundle.account_id).toBe("acct-1");
    expect(typeof bundle.expires_at).toBe("string");
    // L'échange se fait dans la même requête serveur : le code d'autorisation
    // n'existe jamais côté navigateur.
    expect(seen).toContain(OAUTH_TOKEN_URL);
  });

  it("refuse proprement un code invalide plutôt que d'écrire une liaison morte", async () => {
    const { fetchImpl } = openAi({ oauth: () => new Response("", { status: 400 }) });
    const handle = await handleFor(fetchImpl);

    expect(await pollLink(USER, handle, { secret: SECRET, fetchImpl, now: NOW })).toEqual({
      status: "denied",
    });
  });

  it("refuse quand OpenAI répond sans code d'autorisation exploitable", async () => {
    const { fetchImpl } = openAi({ deviceToken: () => Response.json({ authorization_code: "x" }) });
    const handle = await handleFor(fetchImpl);

    expect(await pollLink(USER, handle, { secret: SECRET, fetchImpl, now: NOW })).toEqual({
      status: "denied",
    });
  });

  it("déclare la demande expirée quand le jeton opaque n'est plus lisible", async () => {
    const { fetchImpl } = openAi({});
    const handle = await handleFor(fetchImpl);

    expect(await pollLink(USER, "n-importe-quoi", { secret: SECRET, fetchImpl })).toEqual({
      status: "expired",
    });
    // Passée l'échéance de quinze minutes, le même jeton ne vaut plus rien.
    expect(
      await pollLink(USER, handle, { secret: SECRET, fetchImpl, now: NOW + 16 * 60 * 1000 }),
    ).toEqual({ status: "expired" });
  });

  it("refuse le jeton opaque d'un autre utilisateur", async () => {
    const { fetchImpl } = openAi({});
    const handle = await handleFor(fetchImpl);

    expect(
      await pollLink("utilisateur-b", handle, { secret: SECRET, fetchImpl, now: NOW }),
    ).toEqual({ status: "expired" });
  });

  it("prend un aller-retour manqué pour une attente, jamais pour un refus", async () => {
    const { fetchImpl } = openAi({});
    const handle = await handleFor(fetchImpl);
    const broken: FetchLike = async (url) => {
      if (url === DEVICE_TOKEN_URL) throw new Error("réseau coupé");
      return fetchImpl(url, {});
    };

    expect(await pollLink(USER, handle, { secret: SECRET, fetchImpl: broken, now: NOW })).toEqual({
      status: "pending",
    });
  });
});
