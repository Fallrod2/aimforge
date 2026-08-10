/**
 * Les citations chiffrées, prouvées sans réseau ni modèle (SPEC §5 sexies, V5).
 *
 * C'est le cœur de V5 : ce qui distingue une routine ancrée d'une routine qui
 * en a l'air. Les cinq cas qui comptent sont ici — citation exacte, citation
 * arrondie, citation fausse, citation absente, clé inexistante — parce qu'aucun
 * d'eux ne se provoque à volonté sur un vrai modèle.
 */

import { describe, expect, it } from "vitest";
import {
  CITATION_TOLERANCE,
  type CitableFact,
  normalizeCitationKey,
  parseCitations,
  sanitizeCitationKey,
  stripCitations,
  verifyCitations,
} from "./citations";

const FACTS: readonly CitableFact[] = [
  { key: "HS%", value: 23, label: "Tirs à la tête (30 derniers jours)", display: "23 %" },
  { key: "Precise", value: 401.4, label: "Énergie Precise (dernier bench)", display: "401.4" },
  { key: "Map Icebox", value: 25, label: "Winrate sur Icebox (4 parties)", display: "25 %" },
];

describe("parseCitations", () => {
  it("lit la clé et la valeur d'un marqueur simple", () => {
    expect(parseCitations("Tu es à [HS% 23] de tirs à la tête.")).toEqual([
      { raw: "[HS% 23]", key: "HS%", value: 23 },
    ]);
  });

  it("prend le dernier mot comme valeur : une clé peut contenir des espaces", () => {
    expect(parseCitations("[Map Icebox 25] sur tes dernières parties.")).toEqual([
      { raw: "[Map Icebox 25]", key: "Map Icebox", value: 25 },
    ]);
  });

  it("accepte la virgule décimale, qu'un modèle en français écrira une fois sur deux", () => {
    expect(parseCitations("[K/D 0,9]")[0]?.value).toBe(0.9);
  });

  it("trouve toutes les citations d'un texte, dans l'ordre de lecture", () => {
    const found = parseCitations("[Precise 401] puis [HS% 23], et encore [Precise 401].");

    expect(found.map((citation) => citation.raw)).toEqual([
      "[Precise 401]",
      "[HS% 23]",
      "[Precise 401]",
    ]);
  });

  it("ignore un crochet sans clé : rien ne dit de quelle donnée il parle", () => {
    expect(parseCitations("Trois runs [23] de plus.")).toEqual([]);
  });

  it("ignore un crochet sans nombre", () => {
    expect(parseCitations("Un bloc [tracking] pour finir.")).toEqual([]);
  });

  it("ne garde pas d'état entre deux appels malgré le drapeau global", () => {
    const text = "[HS% 23]";

    expect(parseCitations(text)).toHaveLength(1);
    expect(parseCitations(text)).toHaveLength(1);
  });
});

describe("normalizeCitationKey / sanitizeCitationKey", () => {
  it("compare les clés sans casse ni espaces superflus", () => {
    expect(normalizeCitationKey("  Map   Icebox ")).toBe(normalizeCitationKey("map icebox"));
  });

  it("retire des clés les crochets et les retours à la ligne, qui casseraient le marqueur", () => {
    expect(sanitizeCitationKey("Map [Ice\nbox]")).toBe("Map Ice box");
  });
});

describe("verifyCitations", () => {
  it("accepte une citation exacte et en fait une source", () => {
    const check = verifyCitations(["Tu es à [HS% 23]."], FACTS);

    expect(check).toEqual({
      ok: true,
      sources: [{ label: "Tirs à la tête (30 derniers jours)", value: "23 %" }],
    });
  });

  it("accepte un arrondi : recopier 401 pour 401,4 n'invente rien", () => {
    const check = verifyCitations(["Ton [Precise 401] est le frein."], FACTS);

    expect(check.ok).toBe(true);
  });

  it("accepte l'écart exactement égal à la tolérance", () => {
    const value = 401.4 + CITATION_TOLERANCE;

    expect(verifyCitations([`[Precise ${value}]`], FACTS).ok).toBe(true);
  });

  it("refuse au-delà de la tolérance, et dit la vraie valeur", () => {
    const check = verifyCitations(["Ton [Precise 402] est le frein."], FACTS);

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toContain("chiffre faux");
    expect(check.reason).toContain("[Precise 402]");
    expect(check.reason).toContain("401.4");
  });

  it("refuse une clé qui ne désigne aucune donnée du contexte", () => {
    const check = verifyCitations(["Ton [KAST 71] est bas."], FACTS);

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toContain("ne correspondent à aucune donnée");
    expect(check.reason).toContain("[KAST 71]");
  });

  it("rassemble les deux fautes dans un seul message de relance", () => {
    const check = verifyCitations(["[KAST 71]", "[Precise 402]"], FACTS);

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toContain("[KAST 71]");
    expect(check.reason).toContain("[Precise 402]");
  });

  it("refuse une routine sans aucune citation alors qu'il y avait de quoi citer", () => {
    const check = verifyCitations(["Trois runs, viseur haut."], FACTS);

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toContain("aucune recommandation n'est appuyée");
  });

  it("laisse passer une routine sans citation quand il n'y a rien à citer", () => {
    expect(verifyCitations(["Trois runs, viseur haut."], [])).toEqual({ ok: true, sources: [] });
  });

  it("ne compare ni la casse ni les espaces multiples de la clé", () => {
    expect(verifyCitations(["[map   icebox 25]"], FACTS).ok).toBe(true);
  });

  it("dédoublonne les sources et garde l'ordre de première apparition", () => {
    const check = verifyCitations(
      ["Ton [Precise 401] d'abord.", "Puis [HS% 23], et encore [Precise 401]."],
      FACTS,
    );

    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.sources.map((source) => source.value)).toEqual(["401.4", "23 %"]);
  });
});

describe("stripCitations", () => {
  it("retire le marqueur et recolle l'espace laissé derrière", () => {
    expect(stripCitations("Trois runs [HS% 23] pour remonter.")).toBe("Trois runs pour remonter.");
  });

  it("ne laisse pas d'espace avant la ponctuation", () => {
    expect(stripCitations("Ton tracking décroche [Precise 401], travaille-le.")).toBe(
      "Ton tracking décroche, travaille-le.",
    );
  });

  it("nettoie une parenthèse devenue vide", () => {
    expect(stripCitations("Travaille le tracking ([Precise 401]).")).toBe("Travaille le tracking.");
  });

  it("laisse intact un texte sans marqueur", () => {
    expect(stripCitations("Cinq runs, viseur à hauteur de tête.")).toBe(
      "Cinq runs, viseur à hauteur de tête.",
    );
  });
});
