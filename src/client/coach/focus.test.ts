/**
 * Le pont dashboard → fil (SPEC §5 sexies), réduit à ce qui peut se tromper.
 *
 * Le geste « Débriefer » d'un match dépose un identifiant de debrief puis
 * navigue vers `#/coach`. Ce que la vue en fait est une décision, et c'est la
 * seule du pont : la carte est-elle dans le fil, ou faut-il se rabattre sur
 * l'historique ? Elle se teste sans monter la vue, donc elle se teste ici.
 */

import { describe, expect, it } from "vitest";
import type { ThreadMessage } from "../../shared/coach-thread-contract";
import { appendMessages, planDebriefFocus } from "./focus";

function message(id: number, debriefId: number | null = null): ThreadMessage {
  return {
    id,
    role: debriefId === null ? "user" : "coach",
    content: debriefId === null ? "Analyse ce match." : "Partie serrée sur Ascent.",
    debriefId,
    createdAt: "2026-08-10T19:00:00.000Z",
  };
}

const THREAD: readonly ThreadMessage[] = [message(1), message(2, 11), message(3)];

describe("planDebriefFocus", () => {
  it("ne bouge pas quand rien n'est désigné", () => {
    expect(planDebriefFocus(THREAD, null)).toEqual({ kind: "none" });
  });

  it("désigne la carte du fil quand elle y est", () => {
    expect(planDebriefFocus(THREAD, 11)).toEqual({ kind: "card", debriefId: 11, messageId: 2 });
  });

  it("se rabat sur l'historique quand aucune carte ne référence ce debrief", () => {
    // Debrief antérieur au fil, carte dont la pose a échoué, ou fil effacé : le
    // navigateur ne peut plus poser la carte (migration 0015) et refaire poser
    // coûterait un quota pour un debrief qui existe déjà.
    expect(planDebriefFocus(THREAD, 42)).toEqual({ kind: "history", debriefId: 42 });
  });

  it("se rabat aussi sur l'historique quand le fil est vide", () => {
    expect(planDebriefFocus([], 11)).toEqual({ kind: "history", debriefId: 11 });
  });

  it("retient la première carte, sans hésiter si le fil en portait deux", () => {
    const doubled = [message(1), message(2, 11), message(5, 11)];

    expect(planDebriefFocus(doubled, 11)).toMatchObject({ messageId: 2 });
  });
});

describe("appendMessages", () => {
  it("ajoute les messages d'un nouveau tour à la suite", () => {
    const added = [message(4), message(5, 12)];

    expect(appendMessages(THREAD, added).map((entry) => entry.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("n'ajoute pas deux fois une carte déjà présente (anti-doublon par id)", () => {
    // Le cas réel : la fonction pose la carte et la rend dans sa réponse, et un
    // rechargement du fil la ramène aussi.
    expect(appendMessages(THREAD, [message(2, 11)])).toEqual(THREAD);
  });

  it("rend le fil inchangé — la même référence — quand il n'y a rien à ajouter", () => {
    // Pas une coquetterie : un nouveau tableau à chaque tour ferait re-rendre la
    // liste et re-déclencher le défilement pour rien.
    expect(appendMessages(THREAD, [])).toBe(THREAD);
  });

  it("ne garde qu'une fois un message présent des deux côtés", () => {
    const added = [message(3), message(4)];

    expect(appendMessages(THREAD, added).map((entry) => entry.id)).toEqual([1, 2, 3, 4]);
  });
});
