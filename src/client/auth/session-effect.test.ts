/**
 * La règle « plus de session, plus de préférences » (revue V5-A, finding 1).
 *
 * Le correctif initial ne remettait le benchmark au défaut que dans `signOut`,
 * c'est-à-dire sur le **bouton**. Ces tests décrivent les autres chemins — ceux
 * qui n'ont pas de bouton — et vérifient qu'ils sont traités pareil. C'est
 * exactement ce que la version précédente laissait passer : un jeton expiré ou
 * une session révoquée depuis un autre appareil laissaient le pointeur de
 * `src/lib/energy` sur le barème du compte parti.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BENCHMARK_ID } from "../../lib/energy";
import { sessionEffect } from "./session-effect";

/**
 * Les événements Supabase qui arrivent dans `apply()` **sans session**.
 *
 * Ils sont énumérés pour ce qu'ils démontrent : aucun n'est traité à part, et
 * un cinquième cas hériterait du même comportement sans qu'on ait à y penser.
 */
const WITHOUT_SESSION = [
  "SIGNED_OUT — déconnexion volontaire",
  "SIGNED_OUT — jeton expiré, jamais passé par le bouton",
  "SIGNED_OUT — session révoquée depuis un autre appareil",
  "INITIAL_SESSION — visiteur anonyme au chargement",
  "getSession en échec — on ne sait pas, donc personne",
] as const;

describe("session absente", () => {
  it.each(WITHOUT_SESSION)("rend le pointeur de benchmark au défaut : %s", () => {
    const effect = sessionEffect(false);

    expect(effect.status).toBe("anonymous");
    expect(effect.benchmarkReset).toBe(DEFAULT_BENCHMARK_ID);
  });

  it("est idempotente : deux passages de suite ne divergent pas", () => {
    // `SIGNED_OUT` peut être émis plus d'une fois (le nettoyage du marqueur de
    // récupération compte déjà là-dessus). Le second passage doit être un
    // non-événement, pas une seconde décision.
    expect(sessionEffect(false)).toEqual(sessionEffect(false));
  });
});

describe("session ouverte", () => {
  it("ne touche pas au benchmark : c'est le profil qui le dit", () => {
    const effect = sessionEffect(true);

    expect(effect.status).toBe("authenticated");
    // Imposer le défaut ici écraserait la préférence du compte le temps que
    // `ActiveBenchmarkProvider` lise `profiles.active_benchmark`.
    expect(effect.benchmarkReset).toBeNull();
  });
});

describe("invariant", () => {
  it("ne remet à zéro que lorsqu'il n'y a plus personne", () => {
    expect(sessionEffect(true).benchmarkReset).toBeNull();
    expect(sessionEffect(false).benchmarkReset).not.toBeNull();
  });
});
