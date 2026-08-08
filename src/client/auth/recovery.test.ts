import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRecoveryPending,
  createMemoryStore,
  isRecoveryPending,
  type KeyValueStore,
  markRecoveryPending,
  RECOVERY_KEY,
  trackRecovery,
} from "./recovery";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

let store: KeyValueStore;

beforeEach(() => {
  store = createMemoryStore();
});

describe("marqueur de réinitialisation", () => {
  it("est absent tant que rien ne l'a posé", () => {
    expect(isRecoveryPending(store, ALICE)).toBe(false);
  });

  it("bloque le compte pour lequel il a été posé", () => {
    markRecoveryPending(store, ALICE);
    expect(isRecoveryPending(store, ALICE)).toBe(true);
  });

  it("survit à une relecture : c'est tout l'intérêt d'un marqueur persisté", () => {
    markRecoveryPending(store, ALICE);
    // Simule un rechargement d'onglet : nouvelle lecture du même stockage.
    const reloaded = { ...store };

    expect(isRecoveryPending(reloaded, ALICE)).toBe(true);
    expect(isRecoveryPending(reloaded, ALICE)).toBe(true);
  });

  it("ne bloque pas un autre compte, et s'efface au passage", () => {
    markRecoveryPending(store, ALICE);
    expect(isRecoveryPending(store, BOB)).toBe(false);
    expect(store.getItem(RECOVERY_KEY)).toBeNull();
  });

  it("efface un marqueur orphelin quand il n'y a plus de session", () => {
    markRecoveryPending(store, ALICE);
    expect(isRecoveryPending(store, null)).toBe(false);
    expect(store.getItem(RECOVERY_KEY)).toBeNull();
    // Et il ne ressuscite pas à la connexion suivante du même compte.
    expect(isRecoveryPending(store, ALICE)).toBe(false);
  });

  it("est levé par clearRecoveryPending", () => {
    markRecoveryPending(store, ALICE);
    clearRecoveryPending(store);
    expect(isRecoveryPending(store, ALICE)).toBe(false);
  });

  it("supporte d'être levé alors qu'il n'existe pas", () => {
    expect(() => clearRecoveryPending(store)).not.toThrow();
  });
});

describe("trackRecovery — cycle complet", () => {
  it("pose le blocage sur PASSWORD_RECOVERY", () => {
    expect(trackRecovery(store, "PASSWORD_RECOVERY", ALICE)).toBe(true);
  });

  it("maintient le blocage après un rechargement d'onglet (le trou de sécurité)", () => {
    trackRecovery(store, "PASSWORD_RECOVERY", ALICE);

    // Rechargement : plus aucun état React, seul `INITIAL_SESSION` est émis
    // avec la session restaurée depuis le stockage.
    expect(trackRecovery(store, "INITIAL_SESSION", ALICE)).toBe(true);
    // Et il tient aussi sur les rafraîchissements de jeton qui suivent.
    expect(trackRecovery(store, "TOKEN_REFRESHED", ALICE)).toBe(true);
  });

  it("lève le blocage quand le mot de passe a été changé", () => {
    trackRecovery(store, "PASSWORD_RECOVERY", ALICE);
    clearRecoveryPending(store);

    expect(trackRecovery(store, "USER_UPDATED", ALICE)).toBe(false);
    expect(trackRecovery(store, "INITIAL_SESSION", ALICE)).toBe(false);
  });

  it("lève le blocage à la déconnexion, y compris pour la session suivante", () => {
    trackRecovery(store, "PASSWORD_RECOVERY", ALICE);

    expect(trackRecovery(store, "SIGNED_OUT", null)).toBe(false);
    expect(store.getItem(RECOVERY_KEY)).toBeNull();
    expect(trackRecovery(store, "SIGNED_IN", ALICE)).toBe(false);
  });

  it("ne pose rien sur un PASSWORD_RECOVERY sans session", () => {
    expect(trackRecovery(store, "PASSWORD_RECOVERY", null)).toBe(false);
    expect(store.getItem(RECOVERY_KEY)).toBeNull();
  });

  it("ne bloque pas la connexion d'un autre compte sur le même navigateur", () => {
    trackRecovery(store, "PASSWORD_RECOVERY", ALICE);

    expect(trackRecovery(store, "SIGNED_IN", BOB)).toBe(false);
    expect(trackRecovery(store, "INITIAL_SESSION", BOB)).toBe(false);
  });

  it("rebloque si un second lien de réinitialisation est ouvert", () => {
    trackRecovery(store, "PASSWORD_RECOVERY", ALICE);
    trackRecovery(store, "SIGNED_OUT", null);

    expect(trackRecovery(store, "PASSWORD_RECOVERY", ALICE)).toBe(true);
    expect(trackRecovery(store, "INITIAL_SESSION", ALICE)).toBe(true);
  });
});

describe("createMemoryStore", () => {
  it("se comporte comme un stockage clé/valeur", () => {
    const memory = createMemoryStore();

    expect(memory.getItem("k")).toBeNull();
    memory.setItem("k", "v");
    expect(memory.getItem("k")).toBe("v");
    memory.removeItem("k");
    expect(memory.getItem("k")).toBeNull();
  });

  it("isole deux instances", () => {
    const a = createMemoryStore();
    const b = createMemoryStore();

    markRecoveryPending(a, ALICE);
    expect(isRecoveryPending(b, ALICE)).toBe(false);
  });
});
