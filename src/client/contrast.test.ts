/**
 * Les contrastes réellement affichés (V5-A §5.1).
 *
 * Ce fichier n'est pas un test de la formule — c'est le **relevé** des paires
 * que l'interface met à l'écran, mesuré sur les jetons lus dans `index.css`.
 * Sa raison d'être : une couleur ne se juge pas à l'œil. Chacune des valeurs
 * corrigées ici avait été crue lisible, et aucune ne l'était.
 *
 * Ce qu'il retient de dériver :
 *
 * - un jeton retouché sans mesure fait tomber la paire qui l'utilise ;
 * - la règle de `brand-fill` (blanc pur obligatoire) est vérifiée dans les deux
 *   sens : le blanc passe, `steel-100` échoue. Le second cas est un test
 *   **négatif** assumé — c'est exactement le piège dans lequel la correction
 *   précédente était tombée ;
 * - les surfaces composées (`steel-900/60` sur le fond) sont recalculées à
 *   partir des jetons, jamais recopiées.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  composite,
  contrastRatio,
  parseHex,
  ratioOf,
  readColorTokens,
  relativeLuminance,
  toHex,
} from "./contrast";

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.css"), "utf8");
const TOKENS = readColorTokens(CSS);

/** La valeur d'un jeton, ou l'échec du test s'il a disparu. */
function token(name: string): string {
  const value = TOKENS.get(name);

  if (value === undefined) throw new Error(`Jeton --color-${name} absent de index.css`);
  return value;
}

/** Le seuil AA du texte courant. */
const AA_TEXT = 4.5;
/** Le seuil des éléments non textuels et des états désactivés (WCAG 1.4.11). */
const AA_NON_TEXT = 3;

describe("formule", () => {
  it("mesure les extrêmes connus", () => {
    expect(ratioOf("#ffffff", "#000000")).toBe(21);
    expect(ratioOf("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
    expect(ratioOf("#0b0d10", "#0b0d10")).toBe(1);
  });

  it("est symétrique", () => {
    expect(ratioOf("#e6e8ec", "#b4520a")).toBe(ratioOf("#b4520a", "#e6e8ec"));
  });

  it("compose une couche translucide sur son fond", () => {
    const composed = composite(parseHex("#12151a"), 0.6, parseHex("#0b0d10"));

    // `bg-steel-900/60` sur le fond ne peint pas steel-900 : c'est cette
    // couleur-là, et elle seule, dont un texte doit se détacher.
    expect(toHex(composed)).toBe("#0f1216");
    expect(relativeLuminance(composed)).toBeGreaterThan(relativeLuminance(parseHex("#0b0d10")));
  });

  it("refuse une écriture de couleur invalide", () => {
    expect(() => parseHex("bleu")).toThrow();
  });
});

describe("jetons de surface", () => {
  it("porte la couleur réellement peinte des cartes", () => {
    // Le jeton n'est pas une teinte de plus : c'est la composition exacte de
    // `bg-steel-900/60` sur le fond. S'ils divergent, toutes les mesures de
    // texte sur carte deviennent fausses.
    const painted = toHex(composite(parseHex(token("steel-900")), 0.6, parseHex(token("surface"))));

    expect(painted).toBe(token("surface-raised"));
  });

  it("empile trois niveaux du plus profond au plus clair", () => {
    const levels = ["surface", "surface-raised", "surface-overlay"].map((name) =>
      relativeLuminance(parseHex(token(name))),
    );

    expect(levels[1]).toBeGreaterThan(levels[0] as number);
    expect(levels[2]).toBeGreaterThan(levels[1] as number);
  });
});

describe("texte sur les surfaces", () => {
  const surfaces = ["surface", "surface-raised", "surface-overlay"] as const;

  it.each(["steel-100", "steel-200", "steel-300", "steel-400"])(
    "%s tient AA sur les trois surfaces",
    (ink) => {
      for (const surface of surfaces) {
        expect(ratioOf(token(ink), token(surface))).toBeGreaterThanOrEqual(AA_TEXT);
      }
    },
  );

  it("steel-500 tient AA sur le fond et les cartes, mais pas sur un champ", () => {
    // C'est la frontière d'emploi de la teinte, et la raison pour laquelle les
    // placeholders sont en steel-400 : sur `surface-overlay`, steel-500 tombe à
    // 4,02:1. Le test la nomme pour qu'elle ne se franchisse pas par mégarde.
    expect(ratioOf(token("steel-500"), token("surface"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ratioOf(token("steel-500"), token("surface-raised"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ratioOf(token("steel-500"), token("surface-overlay"))).toBeLessThan(AA_TEXT);
  });

  it("steel-500 reste un état désactivé acceptable partout", () => {
    for (const surface of surfaces) {
      expect(ratioOf(token("steel-500"), token(surface))).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  });

  it("steel-600 n'est plus une couleur de texte", () => {
    // 1,93:1 sur une carte. Il reste une teinte de bordure au survol, jamais une
    // encre — c'est ce que cette borne inférieure documente.
    expect(ratioOf(token("steel-600"), token("surface-raised"))).toBeLessThan(AA_NON_TEXT);
  });
});

describe("pied de page", () => {
  it("passe AA depuis qu'il n'est plus en steel-600", () => {
    expect(ratioOf(token("steel-600"), token("surface"))).toBeLessThan(AA_TEXT); // avant : 2,00:1
    expect(ratioOf(token("steel-400"), token("surface"))).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("braise", () => {
  it("le remplissage porte du blanc pur, jamais steel-100", () => {
    expect(ratioOf("#ffffff", token("brand-fill"))).toBeGreaterThanOrEqual(AA_TEXT);
    // Le piège de la correction précédente : assombrir le fond sans passer au
    // blanc ne suffit pas.
    expect(ratioOf(token("steel-100"), token("brand-fill"))).toBeLessThan(AA_TEXT);
  });

  it("le survol du remplissage tient AA lui aussi", () => {
    expect(ratioOf("#ffffff", token("brand-fill-hover"))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("ember-600 ne peut plus porter de texte", () => {
    // 3,57:1 avec steel-100, 4,38:1 avec du blanc : sous AA dans les deux cas.
    // C'est ce qui a motivé `brand-fill`.
    expect(ratioOf(token("steel-100"), token("ember-600"))).toBeLessThan(AA_TEXT);
    expect(ratioOf("#ffffff", token("ember-600"))).toBeLessThan(AA_TEXT);
  });

  it("le bouton primaire (encre sombre sur brand) tient largement AA", () => {
    expect(ratioOf(token("surface"), token("brand"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ratioOf(token("surface"), token("ember-400"))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("l'anneau de focus se voit sur les trois surfaces", () => {
    for (const surface of ["surface", "surface-raised", "surface-overlay"]) {
      expect(ratioOf(token("brand"), token(surface))).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  });
});

describe("jauges", () => {
  it("la piste vide se voit sur le fond et sur une carte", () => {
    // steel-800 n'en donnait que 1,15:1 sur une carte : la jauge vide était
    // invisible, donc l'échelle aussi.
    expect(ratioOf(token("steel-800"), token("surface-raised"))).toBeLessThan(AA_NON_TEXT);
    expect(ratioOf(token("rail-track"), token("surface-raised"))).toBeGreaterThanOrEqual(
      AA_NON_TEXT,
    );
    expect(ratioOf(token("rail-track"), token("surface"))).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it("le remplissage se détache de la piste", () => {
    // La moitié de l'information est là : où s'arrête le niveau.
    expect(ratioOf(token("rail-fill"), token("rail-track"))).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it("une graduation encore à atteindre se lit sur la piste", () => {
    expect(ratioOf(token("surface"), token("rail-track"))).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

describe("séries du graphe", () => {
  it("les deux courbes restent lisibles sur une carte", () => {
    for (const serie of ["ember-600", "quench-500"]) {
      expect(ratioOf(token(serie), token("surface-raised"))).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  });

  it("ne se séparent pas par la clarté — donc jamais par elle seule", () => {
    // 1,34:1 entre les deux. Le couple a été retenu sur la teinte et le chroma
    // (cf. l'en-tête de `index.css`), pas sur le contraste : le noter ici évite
    // qu'on croie un jour la légende superflue.
    expect(contrastRatio(parseHex(token("ember-600")), parseHex(token("quench-500")))).toBeLessThan(
      AA_NON_TEXT,
    );
  });
});
