import { describe, expect, it } from "vitest";
import {
  MAX_DUREE_MINUTES,
  MAX_FOCUS_LENGTH,
  MIN_DUREE_MINUTES,
} from "../../shared/routine-contract";
import { formatDuration, normalizeFocus, parseDuration } from "./duration";

describe("parseDuration", () => {
  it("lit un entier de minutes", () => {
    expect(parseDuration("45")).toEqual({ ok: true, minutes: 45 });
  });

  it("tolère les espaces et le suffixe « min »", () => {
    expect(parseDuration("  60 min ")).toEqual({ ok: true, minutes: 60 });
    expect(parseDuration("90minutes")).toEqual({ ok: true, minutes: 90 });
  });

  it("refuse un champ vide", () => {
    expect(parseDuration("")).toEqual({ ok: false, message: "Indique une durée." });
    expect(parseDuration("   ").ok).toBe(false);
  });

  it("refuse ce qui n'est pas un nombre", () => {
    expect(parseDuration("une heure").ok).toBe(false);
    expect(parseDuration("45x").ok).toBe(false);
  });

  it("refuse une durée décimale plutôt que de l'arrondir en silence", () => {
    const parsed = parseDuration("45,5");

    expect(parsed.ok).toBe(false);
    expect(parsed.ok || parsed.message).toContain("entières");
  });

  it("refuse les durées hors bornes, aux deux extrémités", () => {
    expect(parseDuration(String(MIN_DUREE_MINUTES - 1)).ok).toBe(false);
    expect(parseDuration(String(MAX_DUREE_MINUTES + 1)).ok).toBe(false);
    expect(parseDuration("-30").ok).toBe(false);
  });

  it("accepte exactement les bornes", () => {
    expect(parseDuration(String(MIN_DUREE_MINUTES)).ok).toBe(true);
    expect(parseDuration(String(MAX_DUREE_MINUTES)).ok).toBe(true);
  });

  it("refuse l'infini et les notations exotiques", () => {
    expect(parseDuration("Infinity").ok).toBe(false);
    expect(parseDuration("1e3").ok).toBe(false);
  });
});

describe("normalizeFocus", () => {
  it("rend null sur un focus vide ou blanc", () => {
    expect(normalizeFocus("")).toBeNull();
    expect(normalizeFocus("   ")).toBeNull();
  });

  it("détoure un focus renseigné", () => {
    expect(normalizeFocus("  tracking  ")).toBe("tracking");
  });

  it("coupe à la borne du contrat plutôt que de laisser la fonction refuser", () => {
    expect(normalizeFocus("x".repeat(MAX_FOCUS_LENGTH + 50))).toHaveLength(MAX_FOCUS_LENGTH);
  });
});

describe("formatDuration", () => {
  it("écrit les minutes sous l'heure", () => {
    expect(formatDuration(45)).toBe("45 min");
  });

  it("écrit les heures rondes sans minutes", () => {
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(120)).toBe("2 h");
  });

  it("écrit les heures et minutes sur deux chiffres", () => {
    expect(formatDuration(90)).toBe("1 h 30");
    expect(formatDuration(65)).toBe("1 h 05");
  });
});
