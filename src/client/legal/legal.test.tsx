/**
 * Les trois documents légaux et leur câblage.
 *
 * Deux choses se vérifient ici, et elles ne se recouvrent pas :
 *
 * 1. **le câblage** — chaque page légale connue du routeur a une entrée dans
 *    le registre, et cette entrée est différée (`lazy`). C'est la promesse
 *    tenue vis-à-vis du bundle initial ;
 * 2. **le contenu obligatoire** — un document légal n'est pas de la prose
 *    libre : sans date de mise à jour, sans contact, sans CNIL, sans hébergeur
 *    ou sans mention des marques citées, il ne remplit pas son office. Le test
 *    fixe ce plancher ; il ne fige pas les tournures.
 *
 * Rendu par `renderToStaticMarkup` : l'environnement de test est `node`, et
 * ces pages sont du JSX pur, sans état ni effet.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LEGAL_VIEWS, type LegalViewId } from "../route";
import { LEGAL_SHORT_LABELS, LEGAL_TITLES, LEGAL_UPDATED_AT, legalHash } from "./documents";
import { LegalFooter } from "./LegalFooter";
import { LegalNoticeView } from "./LegalNoticeView";
import { PrivacyView } from "./PrivacyView";
import { LEGAL_PAGES } from "./pages";
import { TermsView } from "./TermsView";

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

const MARKUP: Readonly<Record<LegalViewId, string>> = {
  privacy: renderToStaticMarkup(<PrivacyView />),
  terms: renderToStaticMarkup(<TermsView />),
  legal: renderToStaticMarkup(<LegalNoticeView />),
};

const TEXT: Readonly<Record<LegalViewId, string>> = {
  privacy: textOf(MARKUP.privacy),
  terms: textOf(MARKUP.terms),
  legal: textOf(MARKUP.legal),
};

describe("registre des pages légales", () => {
  it("couvre exactement les vues légales du routeur", () => {
    expect(Object.keys(LEGAL_PAGES).sort()).toEqual([...LEGAL_VIEWS].sort());
  });

  /**
   * `lazy()` marque son résultat d'un `$$typeof` dédié : c'est la signature
   * publique d'un composant différé, et la seule preuve qu'un `import()`
   * statique ne se soit pas glissé à la place.
   */
  it("ne charge chaque document qu'à son ouverture", () => {
    for (const view of LEGAL_VIEWS) {
      const page = LEGAL_PAGES[view] as unknown as { readonly $$typeof: symbol };

      expect(page.$$typeof, view).toBe(Symbol.for("react.lazy"));
    }
  });
});

describe("les trois documents", () => {
  it("portent leur titre et la date de mise à jour", () => {
    for (const view of LEGAL_VIEWS) {
      expect(TEXT[view], view).toContain(LEGAL_TITLES[view]);
      expect(TEXT[view], view).toContain(`Dernière mise à jour : ${LEGAL_UPDATED_AT}`);
    }
  });

  it("donnent l'adresse de contact de l'éditeur", () => {
    for (const view of LEGAL_VIEWS) {
      expect(MARKUP[view], view).toContain("mailto:alex.abriel3@gmail.com");
      expect(TEXT[view], view).toContain("Alexandre Abriel");
    }
  });

  it("se renvoient les uns aux autres", () => {
    expect(MARKUP.privacy).toContain(legalHash("terms"));
    expect(MARKUP.terms).toContain(legalHash("privacy"));
    expect(MARKUP.legal).toContain(legalHash("privacy"));
  });
});

describe("politique de confidentialité", () => {
  const text = TEXT.privacy;

  it("dit ce qui est collecté, jusqu'à la clé d'API", () => {
    for (const mention of ["Riot ID", "KovaaK's", "clé d'API", "Compteurs d'usage"]) {
      expect(text, mention).toContain(mention);
    }
  });

  it("nomme les sous-traitants", () => {
    for (const provider of [
      "Supabase",
      "Vercel",
      "Anthropic",
      "OpenRouter",
      "Mistral",
      "HenrikDev",
    ]) {
      expect(text, provider).toContain(provider);
    }
  });

  it("annonce les bases légales", () => {
    expect(text).toContain("exécution du contrat");
    expect(text).toContain("intérêt légitime");
  });

  /** Le point le plus regardé d'une politique : ce qu'il reste après le départ. */
  it("dit que la suppression du compte efface tout, en cascade", () => {
    expect(text).toContain("Supprimer le compte supprime tout, en cascade.");
  });

  it("énonce les droits et la voie de réclamation", () => {
    for (const right of ["accès", "rectification", "effacement", "portabilité"]) {
      expect(text, right).toContain(right);
    }
    expect(text).toContain("CNIL");
    expect(text).toContain("www.cnil.fr");
  });
});

describe("conditions générales d'utilisation", () => {
  const text = TEXT.terms;

  it("pose la gratuité, la bêta et l'absence de garantie", () => {
    expect(text).toContain("gratuit");
    expect(text).toContain("bêta");
    expect(text).toContain("en l'état");
  });

  it("encadre l'usage des fonctions IA par des quotas", () => {
    expect(text).toContain("quotas journaliers");
    expect(text).toContain("lève le quota");
  });

  it("relève du droit français", () => {
    expect(text).toContain("droit français");
  });
});

describe("mentions légales", () => {
  const text = TEXT.legal;

  it("nomme l'éditeur, le directeur de la publication et les hébergeurs", () => {
    expect(text).toContain("directeur de la publication");
    expect(text).toContain("Vercel Inc.");
    expect(text).toContain("Supabase, Inc.");
  });

  it("cite les marques et écarte toute affiliation", () => {
    for (const brand of ["KovaaK's", "Voltaic", "Viscose", "Valorant", "Riot Games"]) {
      expect(text, brand).toContain(brand);
    }
    expect(text).toContain("n'est affilié, sponsorisé, approuvé ni soutenu");
  });
});

describe("pied de page légal", () => {
  const markup = renderToStaticMarkup(<LegalFooter />);

  it("porte les trois liens et le copyright", () => {
    for (const view of LEGAL_VIEWS) {
      expect(markup, view).toContain(`href="${legalHash(view)}"`);
      expect(textOf(markup), view).toContain(LEGAL_SHORT_LABELS[view]);
    }
    expect(textOf(markup)).toContain("© 2026 AimForge");
  });
});
