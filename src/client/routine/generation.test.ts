/**
 * La lecture d'un échec de génération de routine.
 *
 * Un seul point, mais il décide de tout l'écran d'erreur : c'est le message du
 * **serveur** qui s'affiche, et un quota atteint n'est pas une panne — il n'a
 * donc pas de « Réessayer ».
 */

import { describe, expect, it } from "vitest";
import { routineFailure } from "./generation";
import { RoutineApiError } from "./routine-api";

describe("routineFailure", () => {
  it("garde le message du serveur et le quota qu'il annonce", () => {
    const cause = new RoutineApiError("La génération a pris trop de temps.", 504, 4);

    expect(routineFailure(cause)).toEqual({
      message: "La génération a pris trop de temps.",
      quota: false,
      remaining: 4,
    });
  });

  it("marque le quota atteint : ce n'est pas une panne, et réessayer n'y ferait rien", () => {
    const cause = new RoutineApiError("Quota du jour atteint.", 429, 0);

    expect(routineFailure(cause)).toMatchObject({ quota: true, remaining: 0 });
  });

  it("rend une panne inattendue affichable, sans quota à annoncer", () => {
    expect(routineFailure(new Error("boum"))).toEqual({
      message: "boum",
      quota: false,
      remaining: null,
    });
    expect(routineFailure("chaîne nue")).toMatchObject({ message: "La génération a échoué." });
  });
});
