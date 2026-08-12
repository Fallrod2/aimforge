/**
 * Les deux nouveautés de la page Profil : le sélecteur de benchmark et le
 * vocabulaire par jeu.
 *
 * Le sélecteur est rendu seul (`renderToStaticMarkup`, `environment: node`) :
 * la page entière demanderait une session, et ce qu'on veut fixer ici n'en
 * dépend pas. Les libellés, eux, se vérifient sur la fonction qui les produit —
 * c'est là que la règle vit, pas dans le JSX qui la répète.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { listBenchmarks } from "../../lib/energy";
import { GAME_IDS, gameVocab } from "../../shared/game-vocab";
import { BenchmarkSection } from "./BenchmarkSection";
import { fieldsFor } from "./ProfileView";

function textOf(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const markup = renderToStaticMarkup(<BenchmarkSection />);

describe("BenchmarkSection", () => {
  it("liste les benchmarks du registre, nom et éditeur", () => {
    for (const benchmark of listBenchmarks()) {
      expect(textOf(markup)).toContain(`${benchmark.name} — ${benchmark.publisher}`);
    }
  });

  it("dit l'état, la date des seuils et le document source", () => {
    const text = textOf(markup);

    expect(text).toContain("Beta");
    expect(text).toContain("seuils du 8 août 2026");
    expect(markup).toContain(listBenchmarks()[0]?.sourceUrl ?? "");
  });

  it("se rend désactivé, et le dit, tant qu'il n'y a qu'un barème", () => {
    // Un sélecteur absent laisserait croire que l'application *est* Voltaic S5.
    // Présent et désactivé, il dit l'inverse : c'est un choix, il n'y en a
    // qu'un pour l'instant.
    expect(listBenchmarks()).toHaveLength(1);
    expect(markup).toContain('id="profile-benchmark"');
    expect(markup).toContain("disabled");
    expect(textOf(markup)).toContain("D'autres benchmarks arriveront");
  });

  it("dit que changer de barème ne réécrit pas l'historique", () => {
    // C'est la question que se pose immédiatement quelqu'un qui voit ce select.
    expect(textOf(markup)).toContain("en changer ne réécrit aucun chiffre");
  });
});

describe("fieldsFor", () => {
  it("écrit les libellés et les exemples dans les mots du jeu", () => {
    for (const game of GAME_IDS) {
      const vocab = gameVocab(game);
      const byName = new Map(fieldsFor(game).map((field) => [field.name, field]));

      expect(byName.get("rangValorant")?.label).toBe(vocab.rank.label);
      expect(byName.get("rangValorant")?.placeholder).toBe(vocab.rank.placeholder);
      expect(byName.get("mainAgent")?.label).toBe(vocab.main.label);
      expect(byName.get("peak")?.placeholder).toBe(vocab.peak.placeholder);
    }
  });

  it("garde les mêmes champs — donc les mêmes colonnes — quel que soit le jeu", () => {
    // Le jeu change le vocabulaire, jamais le schéma (DECISIONS.md D7).
    const names = fieldsFor("valorant").map((field) => field.name);

    for (const game of GAME_IDS) {
      expect(fieldsFor(game).map((field) => field.name)).toEqual(names);
    }
    expect(names).toEqual(["pseudo", "rangValorant", "peak", "mainAgent", "objectif", "notesMaps"]);
  });

  it("ne propose aucun exemple de rang Valorant à un joueur d'un autre jeu", () => {
    for (const game of GAME_IDS) {
      const placeholders = fieldsFor(game)
        .map((field) => field.placeholder)
        .join(" ");

      if (game === "valorant") expect(placeholders).toContain("Ascendant 2");
      else expect(placeholders).not.toContain("Ascendant");
    }
  });
});
