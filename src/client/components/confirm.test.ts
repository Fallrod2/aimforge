/**
 * La machine des gestes destructifs (V5-A §5.4).
 *
 * Ce qui est vérifié ici n'est pas « le bouton change de libellé » mais les
 * quatre règles qui rendent le motif sûr :
 *
 * 1. il faut **deux** appuis, et le second doit tomber dans la fenêtre ;
 * 2. une confirmation périmée ne déclenche rien — même si personne n'a nettoyé
 *    l'état entre-temps ;
 * 3. une seule confirmation est ouverte à la fois ;
 * 4. déclencher désarme, pour qu'un troisième appui ne rejoue pas le geste.
 *
 * Le temps est injecté partout : aucun test n'attend, donc aucun ne devient
 * capricieux le jour où la machine tourne un peu moins vite.
 */

import { describe, expect, it } from "vitest";
import {
  arm,
  CONFIRM_WINDOW_MS,
  type Confirmation,
  defer,
  forget,
  IDLE,
  isArmed,
  isDue,
  press,
  prune,
  remainingMs,
  UNDO_WINDOW_MS,
} from "./confirm";

const T0 = 1_000_000;

describe("confirmation en deux appuis", () => {
  it("n'agit pas au premier appui", () => {
    const first = press(IDLE, "run-12", T0);

    expect(first.fire).toBe(false);
    expect(isArmed(first.state, "run-12", T0)).toBe(true);
  });

  it("agit au second appui dans la fenêtre", () => {
    const first = press(IDLE, "run-12", T0);
    const second = press(first.state, "run-12", T0 + CONFIRM_WINDOW_MS - 1);

    expect(second.fire).toBe(true);
  });

  it("désarme en déclenchant, pour qu'un troisième appui ne rejoue rien", () => {
    const armed = press(IDLE, "run-12", T0).state;
    const fired = press(armed, "run-12", T0 + 500);

    expect(fired.fire).toBe(true);
    expect(fired.state).toBe(IDLE);
    // Le troisième appui repart de zéro : il réarme, il ne supprime pas.
    expect(press(fired.state, "run-12", T0 + 600).fire).toBe(false);
  });

  it("réarme au lieu d'agir quand la fenêtre est passée", () => {
    const armed = press(IDLE, "run-12", T0).state;
    const late = press(armed, "run-12", T0 + CONFIRM_WINDOW_MS);

    expect(late.fire).toBe(false);
    expect(isArmed(late.state, "run-12", T0 + CONFIRM_WINDOW_MS)).toBe(true);
  });

  it("n'ouvre qu'une confirmation à la fois", () => {
    const first = press(IDLE, "run-12", T0).state;
    const second = press(first, "run-13", T0 + 100).state;

    expect(isArmed(second, "run-13", T0 + 100)).toBe(true);
    expect(isArmed(second, "run-12", T0 + 100)).toBe(false);
  });

  it("ne confond pas deux boutons voisins", () => {
    const armed = press(IDLE, "run-12", T0).state;

    // Confirmer une autre ligne pendant que celle-ci est armée n'est pas une
    // confirmation : c'est un premier appui sur l'autre ligne.
    expect(press(armed, "run-13", T0 + 100).fire).toBe(false);
  });
});

describe("fenêtre", () => {
  it("expire sans qu'aucun minuteur ait eu à se déclencher", () => {
    // Un onglet en arrière-plan peut ne rien exécuter pendant une minute :
    // l'affichage se décide sur l'heure, pas sur le nettoyage.
    const armed: Confirmation = arm("fil", T0);

    expect(isArmed(armed, "fil", T0 + CONFIRM_WINDOW_MS - 1)).toBe(true);
    expect(isArmed(armed, "fil", T0 + CONFIRM_WINDOW_MS)).toBe(false);
  });

  it("décompte le temps restant, sans jamais passer sous zéro", () => {
    const armed = arm("fil", T0);

    expect(remainingMs(armed, "fil", T0)).toBe(CONFIRM_WINDOW_MS);
    expect(remainingMs(armed, "fil", T0 + 1_500)).toBe(CONFIRM_WINDOW_MS - 1_500);
    expect(remainingMs(armed, "fil", T0 + 60_000)).toBe(0);
    expect(remainingMs(armed, "autre", T0)).toBe(0);
    expect(remainingMs(IDLE, "fil", T0)).toBe(0);
  });

  it("se nettoie sans effet quand il n'y a rien à nettoyer", () => {
    const armed = arm("fil", T0);

    expect(prune(IDLE, T0)).toBe(IDLE);
    expect(prune(armed, T0 + 1_000)).toBe(armed);
    expect(prune(armed, T0 + CONFIRM_WINDOW_MS)).toBe(IDLE);
    expect(prune(prune(armed, T0 + CONFIRM_WINDOW_MS), T0 + CONFIRM_WINDOW_MS)).toBe(IDLE);
  });
});

describe("action différée et annulation", () => {
  it("n'est pas due avant la fin du délai", () => {
    const pending = defer({ id: 12 }, T0);

    expect(isDue(pending, T0)).toBe(false);
    expect(isDue(pending, T0 + UNDO_WINDOW_MS - 1)).toBe(false);
    expect(isDue(pending, T0 + UNDO_WINDOW_MS)).toBe(true);
  });

  it("ne rend jamais due une attente vide", () => {
    expect(isDue(null, T0 + 10 * UNDO_WINDOW_MS)).toBe(false);
  });

  it("annuler ne défait rien : l'appel n'était pas parti", () => {
    const pending = defer({ id: 12 }, T0);
    const cancelled = forget<{ id: number }>();

    expect(pending?.payload).toEqual({ id: 12 });
    expect(cancelled).toBeNull();
    expect(isDue(cancelled, T0 + UNDO_WINDOW_MS)).toBe(false);
  });

  it("garde de quoi exécuter **et** de quoi afficher", () => {
    const pending = defer({ id: 12, label: "Passe supprimée" }, T0);

    expect(pending?.payload.id).toBe(12);
    expect(pending?.payload.label).toBe("Passe supprimée");
    expect(pending?.scheduledAt).toBe(T0);
  });

  it("ne garde qu'une action en attente : la nouvelle remplace l'ancienne", () => {
    const first = defer({ id: 12 }, T0);
    const second = defer({ id: 13 }, T0 + 100);

    expect(first?.payload.id).toBe(12);
    expect(second?.payload.id).toBe(13);
    // Le délai de la seconde repart de son propre instant.
    expect(isDue(second, T0 + UNDO_WINDOW_MS)).toBe(false);
    expect(isDue(second, T0 + 100 + UNDO_WINDOW_MS)).toBe(true);
  });
});
