import { describe, expect, it } from "vitest";
import { checkBaseUrl, storedBaseUrl } from "./base-url";

describe("checkBaseUrl — normalisation", () => {
  it("ajoute le chemin attendu à une racine d'API", () => {
    expect(checkBaseUrl("https://api.exemple.com/v1")).toEqual({
      ok: true,
      url: "https://api.exemple.com/v1/chat/completions",
    });
  });

  it("ne double pas la barre finale", () => {
    expect(checkBaseUrl("https://api.exemple.com/v1/")).toEqual({
      ok: true,
      url: "https://api.exemple.com/v1/chat/completions",
    });
  });

  it("laisse une URL déjà complète telle quelle", () => {
    expect(checkBaseUrl("https://api.exemple.com/v1/chat/completions")).toEqual({
      ok: true,
      url: "https://api.exemple.com/v1/chat/completions",
    });
  });

  it("accepte un port explicite (vLLM, LM Studio)", () => {
    expect(checkBaseUrl("https://modeles.exemple.com:8000/v1")).toEqual({
      ok: true,
      url: "https://modeles.exemple.com:8000/v1/chat/completions",
    });
  });

  it("ignore les espaces autour", () => {
    expect(checkBaseUrl("  https://api.exemple.com/v1  ")).toEqual({
      ok: true,
      url: "https://api.exemple.com/v1/chat/completions",
    });
  });
});

describe("checkBaseUrl — refus", () => {
  it("refuse une chaîne vide", () => {
    expect(checkBaseUrl("   ").ok).toBe(false);
  });

  it("refuse ce qui n'est pas une URL", () => {
    expect(checkBaseUrl("api.exemple.com/v1").ok).toBe(false);
  });

  it("refuse un protocole exotique", () => {
    expect(checkBaseUrl("file:///etc/passwd").ok).toBe(false);
  });

  // Le serveur, lui, peut atteindre ces adresses : c'est exactement le
  // problème. Une URL de base est saisie par l'utilisateur et appelée depuis
  // l'intérieur de l'infrastructure.
  it.each([
    "http://localhost:11434/v1",
    "http://127.0.0.1/v1",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.5/v1",
    "http://192.168.1.10/v1",
    "http://172.16.0.9/v1",
    "http://[::1]/v1",
    "http://redis.internal/v1",
  ])("refuse une cible du réseau interne (%s)", (url) => {
    expect(checkBaseUrl(url).ok).toBe(false);
  });

  it("refuse une URL porteuse de paramètres", () => {
    expect(checkBaseUrl("https://api.exemple.com/v1?token=abc").ok).toBe(false);
  });

  it("accepte une IP publique en clair — « mon serveur chez moi » est un cas prévu", () => {
    expect(checkBaseUrl("http://203.0.113.7:8000/v1").ok).toBe(true);
  });
});

describe("storedBaseUrl", () => {
  it("retire le chemin d'appel pour ne garder que la base", () => {
    expect(storedBaseUrl("https://api.exemple.com/v1/chat/completions")).toBe(
      "https://api.exemple.com/v1",
    );
  });

  it("laisse une base déjà nue, sans barre finale", () => {
    expect(storedBaseUrl("https://api.exemple.com/v1/")).toBe("https://api.exemple.com/v1");
  });
});

/**
 * PoC de la revue adversariale : les formes IPv6 qui désignent une adresse
 * interne sans ressembler à `::1` ni à un préfixe `fe80:`/`fc`/`fd`. Une IPv4
 * mappée (`::ffff:127.0.0.1`) est normalisée par `new URL` en
 * `[::ffff:7f00:1]` — elle échappait donc à toute comparaison de préfixe.
 */
describe("checkBaseUrl — IPv6 littérales", () => {
  it.each([
    "http://[::ffff:127.0.0.1]/v1",
    "http://[::ffff:169.254.169.254]/v1",
    "http://[::ffff:7f00:1]/v1",
    "http://[64:ff9b::7f00:1]/v1",
    "http://[2606:4700:4700::1111]/v1",
  ])("refuse %s", (url) => {
    expect(checkBaseUrl(url).ok).toBe(false);
  });
});
