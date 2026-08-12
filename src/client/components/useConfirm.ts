/**
 * Le branchement React de la machine des gestes destructifs (`./confirm.ts`).
 *
 * Deux crochets, et rien d'autre :
 *
 * - `useConfirm` tient le bouton armé et les trois façons de le désarmer sans
 *   rien décider — l'expiration, la touche Échap, un clic ailleurs ;
 * - `usePendingUndo` tient l'action différée : la suppression n'est envoyée
 *   qu'au bout de cinq secondes, ce qui rend « Annuler » gratuit — il n'y a
 *   rien à défaire, il y a seulement quelque chose à ne pas faire.
 *
 * Toute la logique de décision est dans le module pur, testé ; ici il n'y a que
 * des minuteurs, des écouteurs et de l'état React. C'est volontaire : ce qui
 * peut se tromper doit pouvoir se tester sans navigateur.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Confirmation,
  type Deferred,
  defer,
  forget,
  IDLE,
  isArmed,
  isDue,
  press as pressMachine,
  prune,
  remainingMs,
  UNDO_WINDOW_MS,
} from "./confirm";

/**
 * L'attribut que porte un bouton de confirmation.
 *
 * Il sert au clic-ailleurs : le désarmement écoute tout le document, et sans ce
 * marqueur il désarmerait le bouton **avant** que son propre clic n'arrive — la
 * confirmation deviendrait impossible à donner. Les composants n'ont pas à s'en
 * souvenir : `ConfirmButton` le pose.
 */
export const CONFIRM_MARKER = "data-confirm";

export interface ConfirmControl {
  /** `key` attend-il sa confirmation ? */
  readonly armed: (key: string) => boolean;
  /** Un appui sur le bouton `key`. `true` = geste confirmé, à exécuter. */
  readonly press: (key: string) => boolean;
  /** Désarme tout — un changement de palier, un dépliage, une navigation. */
  readonly cancel: () => void;
}

export function useConfirm(): ConfirmControl {
  const [state, setState] = useState<Confirmation>(IDLE);
  /**
   * Le miroir de l'état, lu par `press`.
   *
   * `setState` ne rend pas de valeur, et `press` doit répondre « faut-il agir ? »
   * dans le même tour que le clic : la référence est ce qui permet de décider
   * sur l'état courant plutôt que sur celui capturé au rendu précédent.
   */
  const current = useRef<Confirmation>(IDLE);

  const settle = useCallback((next: Confirmation) => {
    current.current = next;
    setState(next);
  }, []);

  const cancel = useCallback(() => settle(IDLE), [settle]);

  const press = useCallback(
    (key: string) => {
      const outcome = pressMachine(current.current, key, Date.now());

      settle(outcome.state);
      return outcome.fire;
    },
    [settle],
  );

  useEffect(() => {
    if (state === null) return;

    const timer = window.setTimeout(
      () => settle(prune(current.current, Date.now())),
      remainingMs(state, state.key, Date.now()),
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") settle(IDLE);
    };
    const onPointerDown = (event: Event) => {
      const target = event.target;

      // Le clic sur un bouton de confirmation lui appartient : le laisser
      // désarmer ici rendrait la confirmation impossible à donner.
      if (target instanceof Element && target.closest(`[${CONFIRM_MARKER}]`) !== null) return;
      settle(IDLE);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [state, settle]);

  return {
    armed: (key: string) => isArmed(state, key, Date.now()),
    press,
    cancel,
  };
}

export interface PendingUndo<T> {
  /** Ce qui attend son « Annuler », ou `null`. C'est lui qui affiche le toast. */
  readonly pending: T | null;
  /** Programme l'action. Une seule attend à la fois : la précédente part aussitôt. */
  readonly schedule: (payload: T) => void;
  /** Renonce. Rien n'est parti, donc rien n'est à défaire. */
  readonly undo: () => void;
}

/**
 * Une action retardée de cinq secondes, annulable jusqu'au bout.
 *
 * Elle est **exécutée au démontage** si le délai n'est pas écoulé : quelqu'un
 * qui supprime une passe puis change d'onglet a supprimé sa passe. La retenir
 * jusqu'au retour, ou la perdre, seraient deux façons de mentir.
 */
export function usePendingUndo<T>(commit: (payload: T) => void): PendingUndo<T> {
  const [pending, setPending] = useState<Deferred<T>>(null);
  const held = useRef<Deferred<T>>(null);
  const timer = useRef<number | null>(null);
  /** Le rappel le plus frais, sans refaire de minuteur à chaque rendu. */
  const commitRef = useRef(commit);

  commitRef.current = commit;

  const clearTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const run = useCallback(() => {
    const waiting = held.current;

    if (waiting === null) {
      clearTimer();
      return;
    }

    const now = Date.now();

    if (!isDue(waiting, now)) {
      // Un minuteur peut se déclencher un cheveu trop tôt. On ne supprime pas
      // avant l'heure : c'est le seul moment où l'annulation est encore ouverte.
      timer.current = window.setTimeout(run, waiting.scheduledAt + UNDO_WINDOW_MS - now);
      return;
    }
    clearTimer();
    held.current = null;
    setPending(null);
    commitRef.current(waiting.payload);
  }, [clearTimer]);

  const schedule = useCallback(
    (payload: T) => {
      // Une seconde demande vaut validation de la première : on ne garde jamais
      // deux annulations ouvertes, l'utilisateur ne saurait plus laquelle il annule.
      if (held.current !== null) {
        const previous = held.current;

        clearTimer();
        held.current = null;
        commitRef.current(previous.payload);
      }

      const next = defer(payload, Date.now());

      held.current = next;
      setPending(next);
      timer.current = window.setTimeout(run, UNDO_WINDOW_MS);
    },
    [clearTimer, run],
  );

  const undo = useCallback(() => {
    clearTimer();
    held.current = null;
    setPending(forget<T>());
  }, [clearTimer]);

  // Le démontage exécute ce qui attendait : un geste confirmé ne s'évapore pas
  // parce qu'on a changé d'écran. Aucun état n'est posé ici — il n'y a plus
  // personne pour le rendre.
  useEffect(() => {
    return () => {
      const waiting = held.current;

      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      held.current = null;
      if (waiting !== null) commitRef.current(waiting.payload);
    };
  }, []);

  return { pending: pending?.payload ?? null, schedule, undo };
}
