/**
 * Le jeton opaque de liaison a un seul rôle de sécurité, et c'est le seul cas
 * qui compte vraiment ici : **il appartient à celui qui a lancé le flux**. Un
 * jeton qu'un autre compte pourrait présenter transformerait la liaison en
 * détournement — les jetons ChatGPT d'une personne atterriraient dans la
 * configuration d'une autre.
 */

import { describe, expect, it } from "vitest";
import { linkSecret, openHandle, sealHandle } from "./codex-handle";

const SECRET = "clé-de-scellement";
const NOW = Date.parse("2026-08-09T12:00:00.000Z");
const DEMANDE = { deviceAuthId: "dev-1", userCode: "ABCD-1234", userId: "utilisateur-a" };

describe("sealHandle / openHandle", () => {
  it("rend la demande à son propriétaire", () => {
    const handle = sealHandle(DEMANDE, SECRET, NOW);

    expect(openHandle(handle, "utilisateur-a", SECRET, NOW + 1000)).toEqual({
      deviceAuthId: "dev-1",
      userCode: "ABCD-1234",
    });
  });

  it("refuse le jeton d'un autre compte — c'est tout l'objet du scellement", () => {
    const handle = sealHandle(DEMANDE, SECRET, NOW);

    expect(openHandle(handle, "utilisateur-b", SECRET, NOW + 1000)).toBeNull();
  });

  it("refuse un jeton retouché", () => {
    const handle = sealHandle(DEMANDE, SECRET, NOW);
    const [body = "", mac = ""] = handle.split(".");
    const forged = `${Buffer.from(
      JSON.stringify({ ...DEMANDE, userId: "utilisateur-b", exp: NOW + 60_000 }),
      "utf8",
    ).toString("base64url")}.${mac}`;

    expect(body).not.toBe("");
    expect(openHandle(forged, "utilisateur-b", SECRET, NOW + 1000)).toBeNull();
  });

  it("refuse un jeton scellé avec une autre clé", () => {
    const handle = sealHandle(DEMANDE, "une-autre-clé", NOW);

    expect(openHandle(handle, "utilisateur-a", SECRET, NOW + 1000)).toBeNull();
  });

  it("refuse un jeton périmé : une demande d'autorisation ne dure pas", () => {
    const handle = sealHandle(DEMANDE, SECRET, NOW);

    // Le flux d'OpenAI est plafonné à quinze minutes.
    expect(openHandle(handle, "utilisateur-a", SECRET, NOW + 16 * 60 * 1000)).toBeNull();
  });

  it("refuse ce qui n'a pas la forme d'un jeton", () => {
    expect(openHandle("", "utilisateur-a", SECRET, NOW)).toBeNull();
    expect(openHandle("sans-point", "utilisateur-a", SECRET, NOW)).toBeNull();
    expect(openHandle(".signature", "utilisateur-a", SECRET, NOW)).toBeNull();
  });
});

describe("linkSecret", () => {
  it("préfère la clé dédiée", () => {
    expect(linkSecret({ AI_LINK_SECRET: "dédiée", SUPABASE_SERVICE_ROLE_KEY: "service" })).toBe(
      "dédiée",
    );
  });

  it("retombe sur la clé de service, présente en production", () => {
    expect(linkSecret({ SUPABASE_SERVICE_ROLE_KEY: "service" })).toBe("service");
  });

  it("tire une clé au hasard plutôt que d'utiliser une constante publique", () => {
    const secret = linkSecret({});

    expect(secret.length).toBeGreaterThan(20);
    // Stable dans le processus : deux appels doivent ouvrir les mêmes jetons.
    expect(linkSecret({ AI_LINK_SECRET: "   " })).toBe(secret);
  });
});
