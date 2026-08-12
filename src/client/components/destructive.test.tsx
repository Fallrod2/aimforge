/**
 * Ce que le geste destructif **dit** (V5-A §5.4).
 *
 * Trois règles de forme, chacune facile à défaire par inadvertance :
 *
 * 1. armé, le bouton pose sa question à l'écran **et** garde un nom accessible
 *    complet : « Confirmer ? » seul ne dit pas ce qu'on confirme ;
 * 2. armé, il se peint en `brand-fill` avec du **blanc pur** — c'est la seule
 *    combinaison pleine qui tienne AA (5,06:1, cf. `contrast.test.ts`), et
 *    revenir à `steel-100` la ferait retomber à 4,12:1 ;
 * 3. le toast propose « Annuler » et se présente comme un état, pas comme une
 *    alerte.
 *
 * Rendu statique : ces composants n'ont besoin ni de session ni de DOM.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConfirmButton, UndoToast } from "./Destructive";
import { CONFIRM_MARKER } from "./useConfirm";

function textOf(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function button(armed: boolean): string {
  return renderToStaticMarkup(
    <ConfirmButton
      label="Supprimer cette passe"
      question="Supprimer définitivement ?"
      armed={armed}
      onPress={() => {}}
    />,
  );
}

describe("ConfirmButton", () => {
  it("montre l'action au repos", () => {
    const markup = button(false);

    expect(textOf(markup)).toBe("Supprimer cette passe");
    expect(markup).not.toContain("aria-label");
  });

  it("pose la question une fois armé, sans perdre son nom accessible", () => {
    const markup = button(true);

    expect(textOf(markup)).toBe("Supprimer définitivement ?");
    expect(markup).toContain('aria-label="Supprimer définitivement ? Supprimer cette passe"');
  });

  it("porte le marqueur qui protège son propre clic", () => {
    // Sans lui, le désarmement au clic-ailleurs arriverait avant ce clic-ci et
    // la confirmation serait impossible à donner (cf. `useConfirm`).
    expect(button(false)).toContain(CONFIRM_MARKER);
  });

  it("se peint en blanc pur sur brand-fill quand il est armé", () => {
    const markup = button(true);

    expect(markup).toContain("bg-brand-fill");
    expect(markup).toContain("text-white");
    expect(markup).not.toContain("text-steel-100");
  });
});

describe("UndoToast", () => {
  it("annonce ce qui est fait et offre le retour en arrière", () => {
    const markup = renderToStaticMarkup(<UndoToast message="Passe supprimée." onUndo={() => {}} />);

    expect(textOf(markup)).toContain("Passe supprimée.");
    expect(textOf(markup)).toContain("Annuler");
  });

  it("est un état, pas une alerte", () => {
    const markup = renderToStaticMarkup(
      <UndoToast message="Routine supprimée." onUndo={() => {}} />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
  });
});
