/**
 * Ce que la landing **montre**, et ce qu'elle ne raconte pas (SPEC V4-B).
 *
 * Une page de présentation dérive vite : on y ajoute un chiffre rond, une
 * promesse arrondie, un prix « à partir de ». Les assertions d'ici tiennent les
 * trois engagements qui la rendent honnête :
 *
 * 1. elle **montre le produit** — les rendus sont ceux de l'application, pas des
 *    images figées, et la démonstration est atteignable sans compte ;
 * 2. elle **n'invente aucun chiffre** — les valeurs du bloc SOURCES sont celles
 *    de la passe de démonstration affichée au-dessus, calculées par le moteur ;
 * 3. elle **traduit son jargon** — bench, énergie, debrief et sous-catégorie
 *    sont expliqués avant d'être nommés.
 *
 * Rendu en `renderToStaticMarkup` : la landing est justement la vue qui ne
 * demande aucune session.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { demoBench, demoRoutine } from "../demo/demo-data";
import { formatEnergy } from "../format";
import { LandingView } from "./LandingView";

const MARKUP = renderToStaticMarkup(<LandingView />);

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

describe("porte d'entrée", () => {
  it("propose les deux gestes : créer un compte, ou voir la démo", () => {
    expect(TEXT).toContain("Créer un compte");
    expect(TEXT).toContain("Voir la démo");
    expect(MARKUP).toContain('href="#/demo"');
    expect(MARKUP).toContain('href="#/connexion"');
  });

  it("dit que la démo s'ouvre sans compte", () => {
    expect(TEXT).toContain("sans compte");
  });
});

describe("le produit est montré, pas décrit", () => {
  /**
   * Le rendu réel du panneau de synthèse : s'il devenait une capture d'écran,
   * l'énergie de la démonstration disparaîtrait du HTML.
   */
  it("rend la synthèse du tracker avec les chiffres du moteur", () => {
    const { run } = demoBench();

    expect(TEXT).toContain(formatEnergy(run.overall));
    expect(run.rank).not.toBeNull();
    expect(TEXT).toContain(run.rank ?? "");
    // La jauge d'énergie est là : elle porte les graduations des rangs.
    expect(TEXT).toContain("Énergie overall");
  });

  it("n'utilise aucune image : tout est rendu par les vrais composants", () => {
    expect(MARKUP).not.toContain("<img");
  });

  it("montre une courbe de progression, étiquetée exemple", () => {
    expect(MARKUP).toContain("<svg");
    expect(TEXT).toContain("Exemple");
  });
});

describe("bloc SOURCES", () => {
  /** La promesse de la section : les chiffres cités sont ceux de la passe. */
  it("affiche les valeurs réelles de la passe de démonstration", () => {
    const bench = demoBench();
    const sources = demoRoutine(bench).sources ?? [];

    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(TEXT, source.label).toContain(source.label);
      expect(TEXT, source.value).toContain(source.value);
    }
  });

  it("annonce ce que le bloc prouve", () => {
    expect(TEXT).toContain("Chaque chiffre cité est vérifié contre tes données");
    expect(TEXT).toContain("SOURCES");
  });
});

describe("jargon traduit avant d'être nommé", () => {
  it("explique bench, énergie, debrief et sous-catégorie", () => {
    expect(TEXT).toContain("On appelle ça un bench");
    expect(TEXT).toContain("une énergie");
    expect(TEXT).toContain("On appelle ça un debrief");
    // « Sous-catégorie » est traduit plutôt que posé : neuf familles de gestes.
    expect(TEXT).toContain("neuf familles de gestes");
  });

  /** Le bénéfice ouvre chaque carte ; le mot du métier vient après, en petit. */
  it("place le bénéfice avant le mot du métier", () => {
    const benefit = TEXT.indexOf("Savoir où tu en es");
    const jargon = TEXT.indexOf("On appelle ça un bench");

    expect(benefit).toBeGreaterThan(-1);
    expect(jargon).toBeGreaterThan(benefit);
  });
});

describe("prix", () => {
  it("annonce la gratuité de la bêta, sans tableau de prix inventé", () => {
    expect(TEXT).toContain("Gratuit pendant la bêta");
    expect(TEXT).not.toContain("/ mois");
    expect(TEXT).not.toContain("€/mois");
  });

  /** Le plafond des analyses IA est dit, et il vient des contrats. */
  it("dit la limite quotidienne des analyses plutôt que de la taire", () => {
    expect(TEXT).toMatch(/\d+ routines et \d+ debriefs par jour/);
  });
});

describe("pied de page légal", () => {
  it("reste accessible avant l'inscription", () => {
    expect(MARKUP).toContain('href="#/confidentialite"');
    expect(MARKUP).toContain('href="#/cgu"');
    expect(MARKUP).toContain('href="#/mentions-legales"');
  });
});
