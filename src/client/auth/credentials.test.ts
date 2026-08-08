import { describe, expect, it } from "vitest";
import {
  type AuthMode,
  MIN_PASSWORD_LENGTH,
  needsPassword,
  validateCredentials,
} from "./credentials";

const MODES: readonly AuthMode[] = ["signin", "signup", "reset"];

describe("needsPassword", () => {
  it("ne demande pas de mot de passe pour un envoi de lien de réinitialisation", () => {
    expect(needsPassword("reset")).toBe(false);
    expect(needsPassword("signin")).toBe(true);
    expect(needsPassword("signup")).toBe(true);
  });
});

describe("validateCredentials", () => {
  it("exige une adresse email dans tous les modes", () => {
    for (const mode of MODES) {
      expect(validateCredentials(mode, "", "motdepasse"), mode).not.toBeNull();
      expect(validateCredentials(mode, "   ", "motdepasse"), mode).not.toBeNull();
    }
  });

  it("refuse ce qui n'a pas la forme d'une adresse", () => {
    for (const email of ["joueur", "joueur@", "@exemple.test", "joueur@exemple", "a b@c.d"]) {
      expect(validateCredentials("signin", email, "motdepasse"), email).not.toBeNull();
    }
  });

  it("accepte une adresse avec étiquette, utilisée pour les comptes de test", () => {
    expect(validateCredentials("signin", "p1-test+42@exemple.test", "motdepasse")).toBeNull();
  });

  it("tolère les espaces autour de l'adresse", () => {
    expect(validateCredentials("signin", "  joueur@exemple.test  ", "motdepasse")).toBeNull();
  });

  it("ignore le mot de passe en mode réinitialisation", () => {
    expect(validateCredentials("reset", "joueur@exemple.test", "")).toBeNull();
  });

  it("exige un mot de passe non vide à la connexion, sans imposer de longueur", () => {
    expect(validateCredentials("signin", "joueur@exemple.test", "")).not.toBeNull();
    // Un ancien mot de passe court reste saisissable : c'est au serveur de trancher.
    expect(validateCredentials("signin", "joueur@exemple.test", "abc")).toBeNull();
  });

  it("impose la longueur minimale de Supabase à l'inscription", () => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    const exact = "a".repeat(MIN_PASSWORD_LENGTH);

    expect(validateCredentials("signup", "joueur@exemple.test", short)).toContain(
      String(MIN_PASSWORD_LENGTH),
    );
    expect(validateCredentials("signup", "joueur@exemple.test", exact)).toBeNull();
  });
});
