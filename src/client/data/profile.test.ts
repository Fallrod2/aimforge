/**
 * La frontière du profil : deux colonnes de préférence (migration `0019`) dont
 * la base ne garantit que la *forme*, jamais l'appartenance à un registre.
 *
 * Ce qui est vérifié ici n'est pas le mapping — il est mécanique — mais la
 * politique de repli, qui n'est pas la même que pour le benchmark d'une passe.
 * Une passe dont le benchmark est inconnu **refuse de s'afficher** (des seuils
 * de remplacement produiraient des énergies fausses en silence, cf.
 * `mapping.ts`). Une *préférence* inconnue, elle, retombe sur le défaut : elle
 * ne décide que de mots et de seuils de saisie, et faire échouer le profil
 * entier coûterait bien plus cher que ce qu'il y a à protéger.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BENCHMARK_ID } from "../../lib/energy";
import { toActiveBenchmark, toGame } from "./profile";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toActiveBenchmark", () => {
  it("garde un benchmark connu du registre", () => {
    expect(toActiveBenchmark(DEFAULT_BENCHMARK_ID)).toBe(DEFAULT_BENCHMARK_ID);
  });

  it("retombe sur le défaut sans faire échouer le profil", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(toActiveBenchmark("voltaic-s9")).toBe(DEFAULT_BENCHMARK_ID);
    // La trace importe : c'est le seul indice qu'un benchmark a disparu du
    // registre alors qu'un profil le désignait encore.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("voltaic-s9");
  });

  it("refuse un benchmark incomplet, que le registre connaît pourtant", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // `viscose-s2` est au registre (une passe qui le porterait doit se relire),
    // mais il n'a pas de barème : personne ne doit se retrouver à saisir dedans.
    expect(toActiveBenchmark("viscose-s2")).toBe(DEFAULT_BENCHMARK_ID);
    expect(String(warn.mock.calls[0]?.[0])).toContain("incomplet");
  });

  it("ne se plaint pas quand il n'y a rien à signaler", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    toActiveBenchmark(DEFAULT_BENCHMARK_ID);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("toGame", () => {
  it("garde les cinq jeux du check de la colonne", () => {
    for (const game of ["valorant", "cs2", "apex", "overwatch", "other"]) {
      expect(toGame(game)).toBe(game);
    }
  });

  it("retombe sur Valorant devant une valeur hors liste", () => {
    expect(toGame("fortnite")).toBe("valorant");
    expect(toGame(null)).toBe("valorant");
    expect(toGame(42)).toBe("valorant");
  });
});
