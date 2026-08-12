/**
 * La règle de cycle de vie des sous-vues de Perfs (V5-A, revue — finding 2).
 *
 * Ce qui est vérifié n'est pas « la bonne vue s'affiche » — ça, le rendu le dit
 * — mais qu'**aucune séquence d'onglets ne démonte une vue déjà visitée**.
 *
 * Le bug qu'elle ferme : une passe supprimée ouvre cinq secondes d'annulation,
 * portées par `usePendingUndo` dans `HistoryView`. Démonter la vue exécute
 * l'attente sur-le-champ (c'est voulu : un geste confirmé ne se perd pas) et
 * emporte le toast avec elle. Passer sur « Saisie » pendant ces cinq secondes
 * refermait donc la fenêtre sans avertissement, à un clic du bouton
 * « Annuler ».
 */

import { describe, expect, it } from "vitest";
import type { PerfsTab } from "../route";
import { isMounted, type MountedTabs, NOTHING_MOUNTED, visit } from "./mounted";

/** Rejoue une suite de bascules d'onglets depuis l'ouverture de l'écran. */
function visited(...tabs: readonly PerfsTab[]): MountedTabs {
  return tabs.reduce<MountedTabs>(visit, NOTHING_MOUNTED);
}

describe("montage des sous-vues", () => {
  it("ne monte rien avant la première visite", () => {
    expect(isMounted(NOTHING_MOUNTED, "saisie")).toBe(false);
    // L'historique tire Recharts : ne pas le charger pour quelqu'un qui ne
    // l'ouvre pas reste la raison d'être du montage paresseux.
    expect(isMounted(NOTHING_MOUNTED, "historique")).toBe(false);
  });

  it("monte la sous-vue visitée, et elle seule", () => {
    const state = visited("saisie");

    expect(isMounted(state, "saisie")).toBe(true);
    expect(isMounted(state, "historique")).toBe(false);
  });

  it("garde l'historique monté après un retour sur la saisie", () => {
    // Le cœur du finding : c'est cette séquence-là qui coupait l'annulation.
    const state = visited("historique", "saisie");

    expect(isMounted(state, "historique")).toBe(true);
    expect(isMounted(state, "saisie")).toBe(true);
  });

  it("garde la saisie montée après un détour par l'historique", () => {
    // La contrepartie déjà en place avant cette revue : dix-huit scores tapés
    // à la main ne se rejouent pas.
    expect(isMounted(visited("saisie", "historique"), "saisie")).toBe(true);
  });

  it("ne redescend jamais, quelle que soit la suite de bascules", () => {
    const sequences: readonly (readonly PerfsTab[])[] = [
      ["historique", "saisie", "historique"],
      ["saisie", "historique", "saisie", "historique", "saisie"],
      ["historique", "historique", "saisie", "saisie"],
    ];

    for (const sequence of sequences) {
      const state = visited(...sequence);

      for (const tab of sequence) expect(isMounted(state, tab)).toBe(true);
    }
  });

  it("ne recrée pas d'état pour une visite déjà enregistrée", () => {
    // Identité conservée : `setMounted` ne provoque pas de rendu à chaque
    // bascule vers un onglet déjà visité.
    const once = visited("historique");

    expect(visit(once, "historique")).toBe(once);
  });
});
