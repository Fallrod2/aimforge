/**
 * Les deux générations du fil, hors de la vue (V4-C §4.9).
 *
 * Le fil en a deux, et elles ne se confondent pas : **répondre** à un message
 * (`threadReply`) et **débriefer** un match (`threadDebrief`). Deux magasins
 * plutôt qu'un, parce que ce sont deux quotas, deux attentes de durées
 * différentes et deux façons d'échouer — les fondre reviendrait à afficher
 * « Le coach réfléchit… » pendant une analyse de partie.
 *
 * Comme pour la routine, l'état vit dans un module : un aller-retour sur Perfs
 * pendant que le coach répond ne perd plus la réponse (cf.
 * `./generation-store.ts`).
 */

import type { StoredDebrief } from "../../shared/coach-contract";
import type { ThreadMessage, ThreadResponse } from "../../shared/coach-thread-contract";
import { lastUndebriefedMatch } from "../data";
import { CoachError, requestDebriefForMatch } from "./coach-api";
import { createGenerationStore, type GenerationFailure } from "./generation-store";
import { requestThreadReply, ThreadError } from "./thread-api";

/** Un échec du fil, tel que l'écran doit le dire (message du serveur d'abord). */
export function threadFailure(cause: unknown, fallback: string): GenerationFailure {
  if (cause instanceof ThreadError || cause instanceof CoachError) {
    return { message: cause.message, quota: cause.quotaReached, remaining: cause.remaining };
  }
  return {
    message: cause instanceof Error ? cause.message : fallback,
    quota: false,
    remaining: null,
  };
}

/* ------------------------------------------------------------------ */
/* Un tour de conversation                                             */
/* ------------------------------------------------------------------ */

/** La demande est le message lui-même : c'est lui que « Réessayer » renvoie. */
export const threadReplyGeneration = createGenerationStore<string, ThreadResponse>({
  run: requestThreadReply,
  failureOf: (cause) => threadFailure(cause, "L'envoi a échoué."),
});

/* ------------------------------------------------------------------ */
/* Le debrief d'un match                                               */
/* ------------------------------------------------------------------ */

/**
 * `matchId` à `null` = le geste part du chip « Analyse mon dernier match » : la
 * recherche du match à débriefer fait partie de la demande, et elle est donc
 * rejouée telle quelle par « Réessayer ». Fourni = il vient de la suggestion du
 * coach, que le serveur a déjà choisie.
 */
export interface DebriefRequest {
  readonly matchId: string | null;
}

/**
 * Le résultat, y compris quand il n'y a rien à débriefer.
 *
 * « Aucun match en attente » n'est **pas** un échec : c'est un état de la base,
 * il ne se répare pas en réessayant, et l'écran l'annonce sans rouge ni bouton.
 */
export type DebriefOutcome =
  | { readonly kind: "none" }
  | {
      readonly kind: "generated";
      readonly debrief: StoredDebrief;
      /** Les messages posés dans le fil, absents si la pose a échoué. */
      readonly thread: readonly ThreadMessage[] | undefined;
    };

export const threadDebriefGeneration = createGenerationStore<DebriefRequest, DebriefOutcome>({
  run: async ({ matchId }) => {
    const target = matchId ?? (await lastUndebriefedMatch())?.matchId ?? null;

    if (target === null) return { kind: "none" };

    // `thread: true` : c'est la fonction qui pose la carte dans le fil, sous la
    // service key (migration 0015), et qui la rend ici.
    const { debrief, thread } = await requestDebriefForMatch(target, { thread: true });

    return { kind: "generated", debrief, thread };
  },
  failureOf: (cause) => threadFailure(cause, "Le debrief n'a pas pu être généré."),
});
