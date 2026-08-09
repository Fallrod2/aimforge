/**
 * Le groupe de jetons est le seul endroit du projet où un secret est **relu**
 * puis réécrit. Ce qui se teste ici n'est donc pas de la sérialisation pour la
 * sérialisation : c'est la frontière entre « la liaison tient » et « il faut
 * relier », et elle se joue sur une expiration.
 */

import { describe, expect, it } from "vitest";
import {
  accountIdOf,
  decodeJwtClaims,
  expiryOf,
  hasExpired,
  needsRefresh,
  parseTokenBundle,
  REFRESH_MARGIN_MS,
  serializeTokenBundle,
} from "./codex-tokens";

function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${part({ alg: "none" })}.${part(claims)}.signature`;
}

const NOW = Date.parse("2026-08-09T12:00:00.000Z");

describe("decodeJwtClaims", () => {
  it("lit la charge utile sans rien vérifier — c'est OpenAI qui valide", () => {
    expect(decodeJwtClaims(jwt({ exp: 42, chatgpt_account_id: "compte" }))).toEqual({
      exp: 42,
      chatgpt_account_id: "compte",
    });
  });

  it("rend l'UTF-8 intact (un base64 lu en latin-1 abîmerait les accents)", () => {
    expect(decodeJwtClaims(jwt({ nom: "Élodie" }))?.nom).toBe("Élodie");
  });

  it("rend null sur ce qui n'est pas un JWT, plutôt que de lever", () => {
    expect(decodeJwtClaims("pas-un-jeton")).toBeNull();
    expect(decodeJwtClaims("a.b.c")).toBeNull();
    expect(decodeJwtClaims("")).toBeNull();
  });
});

describe("accountIdOf", () => {
  it("extrait `chatgpt_account_id`, que le back-end exige en en-tête", () => {
    expect(accountIdOf(jwt({ chatgpt_account_id: "acct-1" }))).toBe("acct-1");
  });

  it("rend null quand le claim manque, est vide, ou que le jeton est absent", () => {
    expect(accountIdOf(jwt({ sub: "x" }))).toBeNull();
    expect(accountIdOf(jwt({ chatgpt_account_id: "" }))).toBeNull();
    expect(accountIdOf(null)).toBeNull();
  });
});

describe("expiryOf", () => {
  it("préfère le claim `exp` du jeton : c'est la vérité d'OpenAI", () => {
    const exp = Math.floor((NOW + 3 * 60 * 60 * 1000) / 1000);

    expect(expiryOf(jwt({ exp }), 60, NOW)).toBe(exp * 1000);
  });

  it("retombe sur `expires_in` quand le jeton n'est pas un JWT lisible", () => {
    expect(expiryOf("opaque", 120, NOW)).toBe(NOW + 120_000);
  });

  it("prend une heure par défaut plutôt que de déclarer le jeton éternel", () => {
    expect(expiryOf("opaque", undefined, NOW)).toBe(NOW + 60 * 60 * 1000);
  });
});

describe("parseTokenBundle", () => {
  it("lit la forme documentée", () => {
    const tokens = parseTokenBundle(
      JSON.stringify({
        access_token: "acces",
        refresh_token: "rafraichir",
        expires_at: "2026-08-09T13:00:00.000Z",
        account_id: "acct-1",
      }),
    );

    expect(tokens).toEqual({
      accessToken: "acces",
      refreshToken: "rafraichir",
      expiresAt: Date.parse("2026-08-09T13:00:00.000Z"),
      accountId: "acct-1",
    });
  });

  it("accepte une échéance en secondes comme en millisecondes", () => {
    const seconds = parseTokenBundle(
      JSON.stringify({ access_token: "a", expires_at: Math.floor(NOW / 1000) }),
    );
    const millis = parseTokenBundle(JSON.stringify({ access_token: "a", expires_at: NOW }));

    expect(seconds?.expiresAt).toBe(NOW - (NOW % 1000));
    expect(millis?.expiresAt).toBe(NOW);
  });

  it("rend null sur une clé d'API collée : ce n'est pas une liaison", () => {
    expect(parseTokenBundle("sk-ant-quelque-chose")).toBeNull();
    expect(parseTokenBundle("{}")).toBeNull();
    expect(parseTokenBundle(JSON.stringify({ access_token: "" }))).toBeNull();
  });

  it("survit à un groupe minimal : jeton d'accès seul", () => {
    expect(parseTokenBundle(JSON.stringify({ access_token: "a" }))).toEqual({
      accessToken: "a",
      refreshToken: null,
      expiresAt: null,
      accountId: null,
    });
  });
});

describe("serializeTokenBundle", () => {
  it("écrit la forme documentée, et rien d'autre", () => {
    const written = JSON.parse(
      serializeTokenBundle({
        accessToken: "acces",
        refreshToken: "rafraichir",
        expiresAt: NOW,
        accountId: "acct-1",
      }),
    ) as Record<string, unknown>;

    expect(Object.keys(written).sort()).toEqual([
      "access_token",
      "account_id",
      "expires_at",
      "refresh_token",
    ]);
    expect(written.expires_at).toBe(new Date(NOW).toISOString());
  });

  it("fait l'aller-retour sans rien perdre", () => {
    const tokens = {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: NOW,
      accountId: "c",
    };

    expect(parseTokenBundle(serializeTokenBundle(tokens))).toEqual(tokens);
  });
});

describe("needsRefresh / hasExpired", () => {
  const tokens = (expiresAt: number | null) => ({
    accessToken: "a",
    refreshToken: "r",
    expiresAt,
    accountId: null,
  });

  it("renouvelle dès l'entrée dans la marge : un jeton qui meurt pendant l'appel est refusé", () => {
    expect(needsRefresh(tokens(NOW + REFRESH_MARGIN_MS - 1), NOW)).toBe(true);
    expect(needsRefresh(tokens(NOW + REFRESH_MARGIN_MS + 1), NOW)).toBe(false);
  });

  it("traite une échéance inconnue comme « à rafraîchir »", () => {
    expect(needsRefresh(tokens(null), NOW)).toBe(true);
  });

  it("distingue « dans la marge » de « vraiment expiré » — tout en dépend", () => {
    expect(hasExpired(tokens(NOW + 1000), NOW)).toBe(false);
    expect(hasExpired(tokens(NOW - 1), NOW)).toBe(true);
    expect(hasExpired(tokens(null), NOW)).toBe(false);
  });
});
