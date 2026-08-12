/**
 * Les deux échecs que le navigateur est seul à voir.
 *
 * Chacun a coûté un message faux à l'utilisateur avant d'être classé ici : une
 * attente sans fin annoncée comme « quelques secondes », et une coupure de
 * plateforme annoncée comme « réponse inattendue ».
 */

import { describe, expect, it } from "vitest";
import { AI_CLIENT_TIMEOUT_MS, AI_MAX_DURATION_S } from "../../shared/ai-timing";
import { aiRequestSignal, opaqueMessage, transportMessage } from "./ai-http";

const OFFLINE = "Le coach est injoignable : vérifie ta connexion.";
const NOT_DEPLOYED = "La fonction n'est pas servie ici.";
const UNEXPECTED = "Réponse inattendue.";

describe("transportMessage", () => {
  it("distingue un abandon sur délai d'une coupure réseau", () => {
    const timeout = new DOMException("délai dépassé", "TimeoutError");

    expect(transportMessage(timeout, OFFLINE)).toContain("n'a pas répondu à temps");
    // Et il prévient que le serveur a pu aboutir : le quota, lui, est décompté.
    expect(transportMessage(timeout, OFFLINE)).toContain("recharge la page");
  });

  it("rend la phrase de la fonction pour tout le reste", () => {
    expect(transportMessage(new TypeError("Failed to fetch"), OFFLINE)).toBe(OFFLINE);
    expect(transportMessage(new DOMException("annulé", "AbortError"), OFFLINE)).toBe(OFFLINE);
  });
});

describe("opaqueMessage", () => {
  it("désigne la plateforme sur un 502 ou un 504 sans corps du contrat", () => {
    // Nos fonctions répondent toujours en JSON, y compris pour échouer : un
    // corps illisible sur ces statuts vient de la coupure, pas d'elles.
    expect(opaqueMessage(504, NOT_DEPLOYED, UNEXPECTED)).toContain("interrompue par la plateforme");
    expect(opaqueMessage(502, NOT_DEPLOYED, UNEXPECTED)).toContain("interrompue par la plateforme");
  });

  it("garde le 404 du serveur de développement, qui a sa propre explication", () => {
    expect(opaqueMessage(404, NOT_DEPLOYED, UNEXPECTED)).toBe(NOT_DEPLOYED);
  });

  it("retombe sur le repli quand le statut ne dit rien de particulier", () => {
    expect(opaqueMessage(500, NOT_DEPLOYED, UNEXPECTED)).toBe(UNEXPECTED);
  });
});

describe("aiRequestSignal", () => {
  it("arme un délai qui laisse le serveur finir le premier", () => {
    const signal = aiRequestSignal();

    expect(signal.aborted).toBe(false);
    expect(AI_CLIENT_TIMEOUT_MS).toBeGreaterThan(AI_MAX_DURATION_S * 1_000);
  });
});
