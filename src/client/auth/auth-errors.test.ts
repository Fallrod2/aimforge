import { describe, expect, it } from "vitest";
import { authErrorMessage, toAuthFailure } from "./auth-errors";

describe("toAuthFailure", () => {
  it("lit une erreur de la librairie Supabase (`code` / `message`)", () => {
    expect(
      toAuthFailure({ code: "invalid_credentials", message: "Invalid login credentials" }),
    ).toEqual({ code: "invalid_credentials", message: "Invalid login credentials" });
  });

  it("lit un corps JSON d'API (`error_code` / `msg`)", () => {
    expect(toAuthFailure({ error_code: "weak_password", msg: "Password is too short" })).toEqual({
      code: "weak_password",
      message: "Password is too short",
    });
  });

  it("lit une redirection OAuth en erreur (`error` / `error_description`)", () => {
    expect(
      toAuthFailure({ error: "server_error", error_description: "Unsupported provider" }),
    ).toEqual({ code: "server_error", message: "Unsupported provider" });
  });

  it("ne suppose rien d'une valeur qui n'est pas un objet", () => {
    for (const cause of [null, undefined, "boum", 42]) {
      expect(toAuthFailure(cause)).toEqual({});
    }
  });
});

describe("authErrorMessage", () => {
  it("traduit les échecs courants sans laisser passer l'anglais", () => {
    expect(
      authErrorMessage({ code: "invalid_credentials", message: "Invalid login credentials" }),
    ).toBe("Email ou mot de passe incorrect.");
    expect(
      authErrorMessage({ code: "email_not_confirmed", message: "Email not confirmed" }),
    ).toContain("confirmé");
    expect(
      authErrorMessage({ code: "user_already_exists", message: "User already registered" }),
    ).toContain("existe déjà");
  });

  it("nomme le provider quand il n'est pas encore activé", () => {
    const failure = {
      code: "validation_failed",
      message: "Unsupported provider: provider is not enabled",
    };

    expect(authErrorMessage(failure, "Discord")).toContain("Discord");
    expect(authErrorMessage(failure, "Discord")).toContain("pas encore activé");
    // Sans nom de provider, le message reste compréhensible.
    expect(authErrorMessage(failure)).toContain("pas encore activé");
  });

  it("reconnaît le provider désactivé au code comme au message", () => {
    expect(authErrorMessage({ code: "provider_disabled" }, "Google")).toContain("Google");
  });

  it("retombe sur le message brut quand le code est inconnu", () => {
    expect(authErrorMessage({ code: "quelque_chose_de_neuf", message: "Something new" })).toBe(
      "Something new",
    );
  });

  it("a toujours une phrase à afficher, même sans rien", () => {
    expect(authErrorMessage(null)).not.toBe("");
    expect(authErrorMessage({ code: "unknown", message: "" })).not.toBe("");
  });
});
