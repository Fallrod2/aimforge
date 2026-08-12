/**
 * Ce que la démonstration publique montre — et surtout ce qu'elle refuse de
 * montrer (SPEC V4-B).
 *
 * Une démo est une promesse tenue d'avance : tout ce qu'on y voit doit exister
 * dans le produit, et tout ce qui n'existe pas sans compte doit en être absent.
 * D'où les deux moitiés de ce fichier : la moitié qui vérifie que les vrais
 * écrans sont là avec les vrais chiffres du moteur, et la moitié qui vérifie
 * qu'aucune donnée qu'on ne peut pas avoir sans compte n'est simulée — pas de
 * bloc Valorant, pas de conversation de coach, pas de debrief inventé.
 *
 * Rendu en `renderToStaticMarkup` : la page ne demande aucune session, et
 * n'émet aucune requête — c'est précisément ce qui la rend rendable ainsi.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatEnergy } from "../format";
import { DemoView } from "./DemoView";
import { demoBench } from "./demo-data";

const MARKUP = renderToStaticMarkup(<DemoView />);

/** Le texte visible du rendu : les assertions parlent de ce qu'on lit. */
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

const TEXT = textOf(MARKUP);

describe("bandeau de démonstration", () => {
  it("se signale en haut de page, et propose de créer un compte", () => {
    expect(TEXT).toContain("Démo");
    expect(TEXT).toContain("les chiffres sont un exemple");
    expect(TEXT).toContain("Crée un compte pour suivre les tiens");
    expect(MARKUP).toContain('href="#/connexion"');
  });
});

describe("les vrais écrans, les vrais chiffres", () => {
  const { run, previous } = demoBench();

  it("montre la passe de démonstration telle que le moteur la calcule", () => {
    expect(TEXT).toContain(formatEnergy(run.overall));
    expect(run.rank).not.toBeNull();
    expect(TEXT).toContain(run.rank ?? "");
  });

  it("porte la jauge d'énergie et l'écart au rang suivant", () => {
    expect(TEXT).toContain("Énergie overall");
    expect(TEXT).toContain("d'énergie pour");
  });

  it("montre les sous-catégories les plus faibles avec leur écart", () => {
    const weakest = [...run.subcategories].sort((a, b) => a.energy - b.energy)[0];

    expect(weakest).toBeDefined();
    expect(TEXT).toContain(weakest?.name ?? "");
    // L'écart existe parce qu'il y a une passe précédente : c'est un vrai écart.
    expect(previous.overall).toBeLessThan(run.overall);
  });

  it("n'affiche aucun état vide : la démo a toujours des données", () => {
    expect(TEXT).not.toContain("Aucune passe enregistrée");
    expect(TEXT).not.toContain("Réessayer");
  });
});

describe("ce que la démo refuse de simuler", () => {
  /**
   * Le mot « Valorant » reste dans la page — mais dans la phrase qui explique
   * son absence, pas dans un emplacement qui ferait semblant d'avoir des
   * parties. C'est la carte qu'on interdit, pas le mot.
   */
  it("ne montre pas de bloc Valorant : il dépend d'un compte lié", () => {
    expect(MARKUP).not.toContain(">Valorant<");
    expect(TEXT).not.toContain("Rang Valorant");
  });

  it("ne montre ni debrief ni conversation de coach", () => {
    expect(TEXT).not.toContain("Dernier debrief");
    expect(TEXT).not.toContain("Ouvrir le coach");
    expect(TEXT).not.toContain("Générer une routine");
  });

  it("dit pourquoi ces deux-là manquent, au lieu de les passer sous silence", () => {
    expect(TEXT).toContain("un exemple de réponse d'IA n'en serait pas un");
  });
});

describe("coque de la page", () => {
  it("porte sa marque et le pied de page légal, sans navigation applicative", () => {
    expect(TEXT).toContain("AimForge");
    expect(MARKUP).toContain('href="#/confidentialite"');
    // Pas de barre d'onglets : la démo n'est pas l'application, et il n'y a
    // rien à y naviguer sans compte. Les libellés de `NAV_ITEMS` sont absents.
    for (const label of ["Perfs", "Coach", "Profil"]) {
      expect(TEXT, label).not.toContain(label);
    }
  });
});
