/**
 * Le vocabulaire par jeu : ce qui doit tenir, c'est qu'aucun jeu ne parle
 * Valorant par accident et qu'une valeur inconnue ne casse rien.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAME,
  GAME_IDS,
  type GameId,
  gameVocab,
  isGameId,
  listGameVocabs,
  toGameId,
} from "./game-vocab.js";

describe("registre", () => {
  it("couvre exactement les valeurs du check de profiles.game", () => {
    expect([...GAME_IDS]).toEqual(["valorant", "cs2", "apex", "overwatch", "other"]);
  });

  it("rend un vocabulaire complet pour chaque jeu", () => {
    for (const id of GAME_IDS) {
      const vocab = gameVocab(id);

      expect(vocab.id).toBe(id);
      for (const text of [
        vocab.label,
        vocab.players,
        vocab.topic,
        vocab.promptRankLabel,
        vocab.promptMainLabel,
        vocab.rank.label,
        vocab.rank.hint,
        vocab.rank.placeholder,
        vocab.peak.label,
        vocab.peak.placeholder,
        vocab.main.label,
        vocab.main.hint,
        vocab.main.placeholder,
      ]) {
        expect(text.trim()).not.toBe("");
      }
    }
  });

  it("liste les jeux dans l'ordre du sélecteur, « Autre » en dernier", () => {
    const ids = listGameVocabs().map((vocab) => vocab.id);

    expect(ids).toEqual([...GAME_IDS]);
    expect(ids.at(-1)).toBe("other");
  });
});

describe("vocabulaire", () => {
  it("ne parle de Valorant qu'à un joueur de Valorant", () => {
    for (const id of GAME_IDS) {
      const vocab = gameVocab(id);
      const spoken = [vocab.players, vocab.topic, vocab.promptRankLabel, vocab.main.label].join(
        " ",
      );

      if (id === "valorant") expect(spoken).toContain("Valorant");
      else expect(spoken).not.toContain("Valorant");
    }
  });

  it("donne à chaque jeu son mot pour le personnage joué", () => {
    const labels: Readonly<Record<GameId, string>> = {
      valorant: "Agent principal",
      cs2: "Rôle principal",
      apex: "Légende principale",
      overwatch: "Héros principal",
      other: "Perso ou rôle principal",
    };

    for (const id of GAME_IDS) {
      expect(gameVocab(id).main.label).toBe(labels[id]);
    }
  });

  it("ne propose aucun exemple de rang pour un jeu inconnu", () => {
    // Un exemple inventé apprendrait une graduation qui n'existe pas : le
    // placeholder redit la question plutôt que de risquer un faux barème.
    expect(gameVocab("other").rank.placeholder).toBe("Ton rang actuel");
  });

  it("garde une phrase d'identité utilisable telle quelle dans un prompt", () => {
    expect(gameVocab("apex").players).toBe("joueurs d'Apex Legends");
    expect(gameVocab("valorant").players).toBe("joueurs de Valorant");
  });
});

describe("frontière", () => {
  it("reconnaît les jeux connus", () => {
    for (const id of GAME_IDS) expect(isGameId(id)).toBe(true);
    expect(isGameId("fortnite")).toBe(false);
  });

  it("retombe sur le défaut plutôt que de lever", () => {
    expect(toGameId("cs2")).toBe("cs2");
    expect(toGameId("fortnite")).toBe(DEFAULT_GAME);
    expect(toGameId(null)).toBe(DEFAULT_GAME);
    expect(toGameId(undefined)).toBe(DEFAULT_GAME);
    expect(DEFAULT_GAME).toBe("valorant");
  });
});
