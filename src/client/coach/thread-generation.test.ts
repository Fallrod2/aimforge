/**
 * La lecture d'un échec du fil.
 *
 * Le fil a deux sources d'erreur — l'envoi (`ThreadError`) et le debrief
 * (`CoachError`) — et une seule règle : c'est le message du serveur qui
 * s'affiche, et un quota atteint n'est pas une panne.
 */

import { describe, expect, it } from "vitest";
import { CoachError } from "./coach-api";
import { ThreadError } from "./thread-api";
import { threadFailure } from "./thread-generation";

const FALLBACK = "L'envoi a échoué.";

describe("threadFailure", () => {
  it("garde le message d'un échec d'envoi et le restant annoncé", () => {
    const cause = new ThreadError("Le coach n'a pas pu répondre.", 502, 7);

    expect(threadFailure(cause, FALLBACK)).toEqual({
      message: "Le coach n'a pas pu répondre.",
      quota: false,
      remaining: 7,
    });
  });

  it("lit aussi bien l'échec du debrief, qui vient d'une autre fonction", () => {
    const cause = new CoachError("Quota du jour atteint.", 429, 0);

    expect(threadFailure(cause, FALLBACK)).toMatchObject({ quota: true, remaining: 0 });
  });

  it("retombe sur la phrase de l'appelant quand l'exception n'en porte pas", () => {
    expect(threadFailure({ boum: true }, FALLBACK)).toEqual({
      message: FALLBACK,
      quota: false,
      remaining: null,
    });
  });
});
